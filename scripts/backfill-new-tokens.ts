/**
 * One-off targeted backfill for newly-added FOCUS_SET tokens.
 *
 * After expanding `FOCUS_TOKENS` in `lib/constants.ts` and re-seeding the
 * `token` table, existing wallets won't have historical transactions in the
 * new tokens — the cron's incremental sync only walks from the last-seen
 * signature forward, and the admin Backfill button resumes from the oldest
 * tx in DB (skipping signatures we already walked but couldn't parse).
 *
 * This script bridges that gap **cheaply**:
 *   - For each non-external wallet, for each requested new token:
 *     - Find the wallet's ATA(s) for that token mint (skip if wallet never held it).
 *     - Walk only THAT ATA's signature history (not the owner's), with
 *       per-asset resume cursor.
 *     - Parse + insert via the existing pipeline; UPSERT-on-conflict-do-nothing
 *       skips anything already ingested.
 *   - Recompute gains for entities whose wallets had new inserts.
 *
 * Cost compared to a full re-walk: 1-2 orders of magnitude fewer Helius calls,
 * since we only touch the new tokens' ATAs (typically 0-100 sigs per wallet)
 * instead of the full owner signature history.
 *
 * Usage (from project root):
 *   bun run scripts/backfill-new-tokens.ts --token=PYUSD --token=USDG
 *
 * Idempotent — safe to re-run. The per-asset cursor (oldest tx in DB for
 * `(walletAddress, asset=<sym>)`) lets a partial run pick up where it left off.
 */

import { and, asc, eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { wallet, transaction } from '../lib/db/schema'
import { heliusRpc, heliusEnhanced, heliusGetTokenAccountsByOwner } from '../lib/helius'
import { hydrateTransactionPrices } from '../lib/transaction-pricing'
import { recomputeEntityGains } from '../lib/orca-gains-writer'
import { toDisplayEntity } from '../lib/entity'
import { parseTransaction } from '../lib/cron/fetch-transactions'
import { PRICE_MINTS } from '../lib/constants'
import type { Transaction } from '../lib/types'

const SIG_PAGE = 1000
const ENHANCED_BATCH = 100
const INSERT_CHUNK = 500

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

// Parse CLI args: --token=PYUSD --token=USDG
const requestedSyms = process.argv
  .filter((a) => a.startsWith('--token='))
  .map((a) => a.slice('--token='.length).toUpperCase())

if (requestedSyms.length === 0) {
  console.error('usage: bun run scripts/backfill-new-tokens.ts --token=SYM1 [--token=SYM2 ...]')
  console.error('  Each SYM must be a key in PRICE_MINTS (lib/constants.ts).')
  process.exit(1)
}

// Resolve symbols → mints, fail fast on unknown
type TargetToken = { symbol: string; mint: string }
const targets: TargetToken[] = []
for (const sym of requestedSyms) {
  const mint = PRICE_MINTS[sym]
  if (!mint) {
    console.error(`Unknown token symbol: ${sym}. Add it to PRICE_MINTS in lib/constants.ts first.`)
    process.exit(1)
  }
  targets.push({ symbol: sym, mint })
}

const wallets = await db.select().from(wallet).where(eq(wallet.isExternal, false))
console.log(`[backfill-new-tokens] start wallets=${wallets.length} tokens=${targets.map((t) => t.symbol).join(',')}`)

const entitiesAffected = new Set<string>()
let totalSigsWalked = 0
let totalInserted = 0
let totalSkipped = 0

for (let widx = 0; widx < wallets.length; widx++) {
  const w = wallets[widx]
  const wPrefix = `[backfill-new-tokens ${widx + 1}/${wallets.length} ${w.entityId} ${shortAddr(w.address)}]`

  // Cache the wallet's full ATA set once per wallet — used both to locate the
  // target ATAs and as `walletAtas` for parseTransaction's ATA-fallback path.
  const allAtas = await heliusGetTokenAccountsByOwner(w.address)
  const walletAtas = new Set<string>(allAtas.map((a) => a.ata))

  for (const { symbol, mint } of targets) {
    const targetAtas = allAtas.filter((a) => a.mint === mint)
    if (targetAtas.length === 0) {
      totalSkipped++
      continue
    }

    // Per-asset resume cursor: oldest tx in DB for (wallet, asset)
    const [oldest] = await db
      .select({ txHash: transaction.txHash })
      .from(transaction)
      .where(and(eq(transaction.walletAddress, w.address), eq(transaction.asset, symbol)))
      .orderBy(asc(transaction.blockTime))
      .limit(1)
    const startBefore = oldest?.txHash

    for (const { ata } of targetAtas) {
      const allSigs = new Set<string>()
      let before: string | undefined = startBefore
      while (true) {
        const opts: Record<string, unknown> = { limit: SIG_PAGE }
        if (before) opts.before = before
        const sigRes = await heliusRpc('getSignaturesForAddress', [ata, opts])
        const sigs: Array<{ signature: string; blockTime: number | null; err: unknown }> = sigRes?.result ?? []
        if (sigs.length === 0) break
        for (const s of sigs) {
          if (s.err == null) allSigs.add(s.signature)
        }
        if (sigs.length < SIG_PAGE) break
        const last = sigs[sigs.length - 1]
        if (!last?.signature || last.signature === before) break
        before = last.signature
      }
      totalSigsWalked += allSigs.size

      if (allSigs.size === 0) continue

      // Fetch parsed txs and emit moves for FOCUS_SET assets — only `symbol`
      // moves should land in DB for this wallet (other focus moves should
      // already be present from prior backfills).
      const sigArr = Array.from(allSigs)
      const moves: ReturnType<typeof parseTransaction> = []
      for (let i = 0; i < sigArr.length; i += ENHANCED_BATCH) {
        const batch = sigArr.slice(i, i + ENHANCED_BATCH)
        const txs = await heliusEnhanced(batch)
        for (const tx of txs) {
          if (tx?.transactionError != null) continue
          moves.push(...parseTransaction(tx, w.address, w.entityId, wPrefix, walletAtas))
        }
      }

      if (moves.length === 0) continue

      const txsForHydrate: Transaction[] = moves.map((m) => ({
        txHash: m.txHash, walletAddr: m.walletAddress, wallet: '', entity: m.entityId,
        blockTime: Math.floor(m.blockTime.getTime() / 1000),
        date: m.blockTime.toISOString(), asset: m.asset,
        qty: m.direction === 'in' ? m.qty : -m.qty,
        dir: m.direction === 'in' ? 'In' : 'Out',
        price: m.price, usd: m.usd, priceSource: m.priceSource,
        counterparty: m.counterparty, category: null,
      }))
      const { transactions: hydrated } = await hydrateTransactionPrices(txsForHydrate, { priceCache: {}, fetchMissingHistory: true })

      const rows = moves.map((m, idx) => {
        const h = hydrated[idx]
        return {
          txHash: m.txHash, walletAddress: m.walletAddress, entityId: m.entityId,
          blockTime: m.blockTime, asset: m.asset, qty: String(m.qty),
          direction: m.direction,
          price: h.price != null ? String(h.price) : null,
          usd: h.usd != null ? String(h.usd) : null,
          priceSource: h.priceSource, counterparty: m.counterparty,
        }
      })

      let inserted = 0
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK)
        const res = await db.insert(transaction).values(chunk).onConflictDoNothing().returning()
        inserted += res.length
      }
      totalInserted += inserted
      if (inserted > 0) entitiesAffected.add(w.entityId)
      console.log(`${wPrefix} token=${symbol} ata=${shortAddr(ata)} sigs=${allSigs.size} moves=${moves.length} inserted=${inserted}`)
    }
  }
}

// Recompute gains for any entity that had inserts. Failures are non-fatal —
// the rows landed; gains can be recomputed manually later.
for (const entityId of entitiesAffected) {
  const displayEntity = toDisplayEntity(entityId)
  try {
    const { totals } = await recomputeEntityGains(displayEntity)
    console.log(`[backfill-new-tokens] gains recomputed entity=${displayEntity} totals=${JSON.stringify(totals)}`)
  } catch (e) {
    console.error(`[backfill-new-tokens] gains recompute failed entity=${displayEntity} message=${(e as Error).message}`)
  }
}

console.log(`[backfill-new-tokens] done wallets=${wallets.length} tokens=${targets.map((t) => t.symbol).join(',')} sigsWalked=${totalSigsWalked} inserted=${totalInserted} entitiesAffected=${entitiesAffected.size} walletTokenSkipped=${totalSkipped}`)
process.exit(0)
