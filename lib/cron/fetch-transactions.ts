import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, transaction } from '@/lib/db/schema'
import { heliusRpc, heliusEnhanced, heliusGetTokenAccountsByOwner } from '@/lib/helius'
import { FOCUS_SET, STABLE_TOKENS, getSym } from '@/lib/constants'
import { hydrateTransactionPrices, primeLatestPrices } from '@/lib/transaction-pricing'
import { recomputeEntityGains } from '@/lib/orca-gains-writer'
import { toDisplayEntity } from '@/lib/entity'
import type { Transaction } from '@/lib/types'

type Direction = 'in' | 'out'

type ParsedMove = {
  txHash: string
  walletAddress: string
  entityId: string
  blockTime: Date
  asset: string
  qty: number
  direction: Direction
  price: number | null
  usd: number | null
  priceSource: string | null
  counterparty: string | null
}

/** Convert a ParsedMove (cron-internal) to the Transaction shape that
 * hydrateTransactionPrices expects. */
function moveToTx(m: ParsedMove): Transaction {
  return {
    txHash: m.txHash,
    walletAddr: m.walletAddress,
    wallet: '',
    entity: m.entityId,
    blockTime: Math.floor(m.blockTime.getTime() / 1000),
    date: m.blockTime.toISOString(),
    asset: m.asset,
    qty: m.direction === 'in' ? m.qty : -m.qty,
    dir: m.direction === 'in' ? 'In' : 'Out',
    price: m.price,
    usd: m.usd,
    priceSource: m.priceSource,
    counterparty: m.counterparty,
    category: null,
  }
}

/**
 * Find the wallet owner most likely to be the counterparty for a movement
 * of `ourDelta` units of `mint` (null = SOL) for `ourOwner`.
 *
 * Aggregates per-owner deltas across `accountData[]` and returns the owner
 * with the largest opposite-direction delta. Returns null when no candidate
 * exists or `accountData` lacks the necessary entries.
 *
 * - For SPL tokens, the same owner can appear across multiple ATAs in one tx
 *   (e.g. fee account + main account); aggregating by owner avoids returning
 *   one ATA's owner multiple times.
 * - For multi-leg routes (e.g. Jupiter swaps), the largest opposite-side
 *   owner wins — usually the AMM pool. UI can render the address; the user
 *   can click Solscan if they need to see the protocol.
 * - Returns null instead of falling back to ATA pubkeys — keeps the column
 *   honest: only ever a wallet owner address, or empty.
 */
function findCounterpartyOwner(
  ourOwner: string,
  ourDelta: number,
  mint: string | null,
  accountData: any[],
): string | null {
  const totals = new Map<string, number>()

  if (mint === null) {
    // SOL — aggregate nativeBalanceChange per account. account ≡ owner for system accounts.
    for (const a of accountData ?? []) {
      if (!a?.account) continue
      const delta = (a.nativeBalanceChange ?? 0) / 1e9
      totals.set(a.account, (totals.get(a.account) ?? 0) + delta)
    }
  } else {
    for (const a of accountData ?? []) {
      for (const c of a?.tokenBalanceChanges ?? []) {
        if (c.mint !== mint || !c.userAccount) continue
        const decimals = c.rawTokenAmount?.decimals ?? 0
        const raw = parseFloat(c.rawTokenAmount?.tokenAmount ?? '0')
        const safeRaw = Number.isFinite(raw) ? raw : 0
        const amt = safeRaw / Math.pow(10, decimals)
        totals.set(c.userAccount, (totals.get(c.userAccount) ?? 0) + amt)
      }
    }
  }

  let best: string | null = null
  let bestAbs = 0
  for (const [owner, delta] of totals) {
    if (owner === ourOwner) continue
    if (Math.sign(delta) === Math.sign(ourDelta)) continue
    const abs = Math.abs(delta)
    if (abs > bestAbs) {
      bestAbs = abs
      best = owner
    }
  }
  return best
}

/**
 * Decode a Helius Enhanced-API parsed transaction into one or more normalized
 * movements. Reads SOL deltas from `accountData[].nativeBalanceChange` and token
 * deltas from `accountData[].tokenBalanceChanges[]` for focus tokens only
 * (SOL, ORCA, USDC, USDT).
 */
// exported for tests
export function parseTransaction(
  tx: any,
  walletAddress: string,
  entityId: string,
  logPrefix?: string,
  walletAtas?: Set<string>,
): ParsedMove[] {
  if (!tx || tx.transactionError != null) return []
  const accountData = Array.isArray(tx.accountData) ? tx.accountData : []
  const blockTimeUnix = tx.timestamp
  if (!blockTimeUnix) return []
  const blockTime = new Date(blockTimeUnix * 1000)
  const sig = tx.signature ?? ''
  const moves: ParsedMove[] = []

  // SOL delta — net change for this wallet from accountData, then add back fee
  // if this wallet was the feePayer (so we measure intent, not gas cost).
  const myEntry = accountData.find((a: any) => a?.account === walletAddress)
  if (myEntry) {
    const lamports = (myEntry.nativeBalanceChange ?? 0) / 1e9
    const feeRefund = walletAddress === tx.feePayer ? (tx.fee ?? 0) / 1e9 : 0
    const delta = lamports + feeRefund
    if (Math.abs(delta) > 0.001) {
      moves.push({
        txHash: sig,
        walletAddress,
        entityId,
        blockTime,
        asset: 'SOL',
        qty: Math.abs(delta),
        direction: delta > 0 ? 'in' : 'out',
        price: null,
        usd: null,
        priceSource: null,
        counterparty: findCounterpartyOwner(walletAddress, delta, null, accountData),
      })
    }
  }

  // Token deltas — aggregate per mint where userAccount === walletAddress,
  // or where tokenAccount is a known ATA (fallback for legacy Helius entries
  // where userAccount is missing).
  const myDeltas: Record<string, number> = {}
  for (const a of accountData) {
    for (const c of a?.tokenBalanceChanges ?? []) {
      const isAttributedToOurWallet =
        c?.userAccount === walletAddress
        || (!c?.userAccount && walletAtas && c?.tokenAccount && walletAtas.has(c.tokenAccount))
      if (!isAttributedToOurWallet) continue
      const sym = getSym(c.mint)
      if (!sym || !FOCUS_SET.has(sym)) continue
      const decimals = c.rawTokenAmount?.decimals ?? 0
      const raw = parseFloat(c.rawTokenAmount?.tokenAmount ?? '0')
      const safeRaw = Number.isFinite(raw) ? raw : 0
      myDeltas[c.mint] = (myDeltas[c.mint] ?? 0) + safeRaw / Math.pow(10, decimals)
    }
  }

  // Defensive: warn if a focus-mint balance change is missing userAccount entirely
  // AND the ATA-fallback didn't recover it (Helius parser regression).
  for (const a of accountData) {
    for (const c of a?.tokenBalanceChanges ?? []) {
      if (c?.userAccount) continue
      // Skip if we successfully recovered via ATA-fallback — warn would be misleading.
      if (walletAtas && c?.tokenAccount && walletAtas.has(c.tokenAccount)) continue
      const sym = getSym(c?.mint)
      if (sym && FOCUS_SET.has(sym)) {
        const prefix = logPrefix ?? '[fetch-tx]'
        console.warn(`${prefix}   warn: sig ${sig.slice(0, 8)}… focus-mint ${sym} tokenBalanceChange has no userAccount — Helius parser regression?`)
      }
    }
  }

  for (const mint of Object.keys(myDeltas)) {
    const sym = getSym(mint)!
    const delta = myDeltas[mint]
    if (Math.abs(delta) < 0.001) continue
    moves.push({
      txHash: sig,
      walletAddress,
      entityId,
      blockTime,
      asset: sym,
      qty: Math.abs(delta),
      direction: delta > 0 ? 'in' : 'out',
      price: STABLE_TOKENS.has(sym) ? 1 : null,
      usd: STABLE_TOKENS.has(sym) ? Math.abs(delta) : null,
      priceSource: STABLE_TOKENS.has(sym) ? 'stable' : null,
      counterparty: findCounterpartyOwner(walletAddress, delta, mint, accountData),
    })
  }

  return moves
}

type WalletResult = {
  ok: boolean
  signaturesScanned: number
  moves: number
  inserted: number
  failedTxs: number
  error?: string
}

const SIG_PAGE = 1000   // getSignaturesForAddress max page
const ENHANCED_BATCH = 100   // Helius /v0/transactions POST max
const INSERT_CHUNK = 500   // chunk DB inserts to avoid Drizzle/postgres-js stack overflow on large wallets
const MAX_PAGES_PER_WALLET_INCREMENTAL = 10   // safety net per source in incremental mode

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

type SigSource =
  | { kind: 'owner'; address: string }
  | { kind: 'ata'; address: string; mint: string }

async function processWallet(
  walletRow: typeof wallet.$inferSelect,
  opts: { full?: boolean; logPrefix?: string; priceCache?: Record<string, unknown> } = {},
): Promise<WalletResult> {
  const prefix = opts.logPrefix ?? `[fetch-tx ${walletRow.entityId} ${shortAddr(walletRow.address)}]`
  const startedAt = Date.now()

  // Incremental mode: determine the high-water mark — both as a Helius `until` cursor
  // for the owner source, and as a blockTime cutoff applied to all sources.
  let untilSig: string | undefined
  let untilBlockTimeUnix: number | undefined
  if (!opts.full) {
    const [latest] = await db.select({ txHash: transaction.txHash, blockTime: transaction.blockTime })
      .from(transaction)
      .where(eq(transaction.walletAddress, walletRow.address))
      .orderBy(desc(transaction.blockTime))
      .limit(1)
    untilSig = latest?.txHash ?? undefined
    if (latest?.blockTime) {
      untilBlockTimeUnix = Math.floor(latest.blockTime.getTime() / 1000)
    }
  }

  // Enumerate the wallet's focus-mint ATAs. Each ATA address has its own
  // sig-history universe that owner-keyed queries don't necessarily cover
  // (e.g. clean SPL transfers where the owner's pubkey isn't in accountKeys).
  const atas = await heliusGetTokenAccountsByOwner(walletRow.address)
  const walletAtas = new Set<string>(atas.map(a => a.ata))
  const sources: SigSource[] = [
    { kind: 'owner', address: walletRow.address },
    ...atas.map((a): SigSource => ({ kind: 'ata', address: a.ata, mint: a.mint })),
  ]
  console.log(`${prefix} start mode=${opts.full ? 'full' : 'incremental'}${untilSig ? ` until=${untilSig.slice(0, 8)}…` : ''} sources=${sources.length} (1 owner + ${atas.length} atas)`)

  // Page sigs from each source, dedupe via Set.
  const allSigs = new Set<string>()
  const pageCap = opts.full ? Number.MAX_SAFE_INTEGER : MAX_PAGES_PER_WALLET_INCREMENTAL
  let sigErrFiltered = 0

  for (const source of sources) {
    let before: string | undefined
    let pagesWalked = 0
    for (let page = 0; page < pageCap; page++) {
      const pageOpts: Record<string, unknown> = { limit: SIG_PAGE }
      if (before) pageOpts.before = before
      // `until=<sig>` only valid against the source whose history contains that sig
      // (the owner's). ATAs have a different sig universe — we use the blockTime
      // cutoff below instead.
      if (untilSig && source.kind === 'owner') pageOpts.until = untilSig

      const sigRes = await heliusRpc('getSignaturesForAddress', [source.address, pageOpts])
      const sigs: Array<{ signature: string; blockTime: number | null; err: unknown }> = sigRes?.result ?? []
      if (sigs.length === 0) break

      let pageNew = 0
      let pageErr = 0
      let pageOldest = Infinity
      for (const s of sigs) {
        if (s.blockTime != null && s.blockTime < pageOldest) pageOldest = s.blockTime
        if (s.err != null) {
          sigErrFiltered++
          pageErr++
          continue
        }
        if (untilBlockTimeUnix != null && s.blockTime != null && s.blockTime <= untilBlockTimeUnix) continue
        if (!allSigs.has(s.signature)) {
          allSigs.add(s.signature)
          pageNew++
        }
      }

      const errSuffix = pageErr > 0 ? ` (${pageErr} err)` : ''
      console.log(`${prefix}   source=${source.kind}(${shortAddr(source.address)}) page ${page + 1}: ${sigs.length} sigs${errSuffix}, +${pageNew} new`)
      pagesWalked++

      // Stop conditions
      if (sigs.length < SIG_PAGE) break
      if (untilBlockTimeUnix != null && pageOldest <= untilBlockTimeUnix) break
      const last = sigs[sigs.length - 1]
      if (!last?.signature || last.signature === before) break
      before = last.signature
    }
    if (!opts.full && pagesWalked >= pageCap) {
      console.warn(`${prefix}   warn: source=${source.kind}(${shortAddr(source.address)}) hit page cap (${pageCap} × ${SIG_PAGE} sigs) — wallet may be behind on this source`)
    }
  }

  // Fetch parsed tx data in batches of 100 via Helius Enhanced API.
  const sigArray = Array.from(allSigs)
  const allMoves: ParsedMove[] = []
  let scanned = 0
  let failedTxs = 0
  let noMoves = 0

  for (let i = 0; i < sigArray.length; i += ENHANCED_BATCH) {
    const batch = sigArray.slice(i, i + ENHANCED_BATCH)
    const txs = await heliusEnhanced(batch)
    if (txs.length !== batch.length) {
      console.warn(`${prefix}   warn: Helius Enhanced returned ${txs.length} txs for ${batch.length} sigs — ${batch.length - txs.length} silently dropped`)
    }
    for (const tx of txs) {
      scanned++
      if (tx?.transactionError != null) {
        failedTxs++
        continue
      }
      const parsed = parseTransaction(tx, walletRow.address, walletRow.entityId, prefix, walletAtas)
      if (parsed.length === 0) noMoves++
      allMoves.push(...parsed)
    }
  }

  // Hydrate prices for the entire wallet's moves in one batch (uses shared priceCache).
  const txsForHydrate = allMoves.map(moveToTx)
  const { transactions: hydrated } = await hydrateTransactionPrices(txsForHydrate, {
    priceCache: opts.priceCache ?? {},
    fetchMissingHistory: true,
  })

  let inserted = 0
  if (allMoves.length > 0) {
    const rowsToInsert = allMoves.map((m, idx) => {
      const h = hydrated[idx]
      return {
        txHash: m.txHash,
        walletAddress: m.walletAddress,
        entityId: m.entityId,
        blockTime: m.blockTime,
        asset: m.asset,
        qty: String(m.qty),
        direction: m.direction,
        price: h.price != null ? String(h.price) : null,
        usd: h.usd != null ? String(h.usd) : null,
        priceSource: h.priceSource,
        counterparty: m.counterparty,
      }
    })
    for (let i = 0; i < rowsToInsert.length; i += INSERT_CHUNK) {
      const chunk = rowsToInsert.slice(i, i + INSERT_CHUNK)
      const res = await db.insert(transaction).values(chunk).onConflictDoNothing().returning()
      inserted += res.length
    }
  }

  const elapsedMs = Date.now() - startedAt
  const sigErrSuffix = sigErrFiltered > 0 ? ` (${sigErrFiltered} err filtered)` : ''
  console.log(`${prefix} done: ${allSigs.size} sigs${sigErrSuffix}, ${scanned} txs, ${failedTxs} failed, ${noMoves} no-moves, ${allMoves.length} moves, ${inserted} inserted in ${elapsedMs}ms`)
  return { ok: true, signaturesScanned: scanned, moves: allMoves.length, inserted, failedTxs }
}

/**
 * Cron: pull new signatures per Orca-owned wallet since last-seen, parse into
 * movements, upsert into `transaction` with unique-constraint dedup.
 *
 * Pass `{ full: true }` to ignore the incremental `until` cursor and page cap —
 * drains full wallet history until Helius returns no more signatures. Intended
 * for one-shot historical backfills; don't use on the recurring cron schedule.
 */
export async function fetchTransactionsJob(opts: { full?: boolean; walletAddr?: string } = {}) {
  const wallets = opts.walletAddr
    ? await db.select().from(wallet).where(and(eq(wallet.address, opts.walletAddr), eq(wallet.isExternal, false)))
    : await db.select().from(wallet).where(eq(wallet.isExternal, false))
  if (opts.walletAddr && wallets.length === 0) {
    throw new Error(`wallet not found in registry (or is external): ${opts.walletAddr}`)
  }
  const results: Record<string, WalletResult> = {}
  let totalInserted = 0
  let failed = 0
  const entitiesWithInserts = new Set<string>()

  // Per-run price cache, shared across all wallets and pages.
  // Pre-populate the `<token>::latest` keys so hydrateTransactionPrices' 3-day
  // fallback can resolve very recent transactions without an extra API call.
  const priceCache: Record<string, unknown> = {}
  try {
    await primeLatestPrices(priceCache)
  } catch (err) {
    console.warn(`[fetch-tx] warning: failed to prime latest prices: ${(err as Error).message}`)
  }

  const scopeNote = opts.walletAddr ? ` scope=single-wallet(${shortAddr(opts.walletAddr)})` : ''
  console.log(`[fetch-tx] job start: ${wallets.length} wallets, mode=${opts.full ? 'full' : 'incremental'}${scopeNote}`)
  const jobStartedAt = Date.now()

  for (let idx = 0; idx < wallets.length; idx++) {
    const w = wallets[idx]
    const logPrefix = `[fetch-tx ${idx + 1}/${wallets.length} ${w.entityId} ${shortAddr(w.address)}]`
    try {
      const r = await processWallet(w, { ...opts, logPrefix, priceCache })
      results[w.address] = r
      totalInserted += r.inserted
      if (r.inserted > 0) entitiesWithInserts.add(w.entityId)
    } catch (err) {
      results[w.address] = {
        ok: false,
        signaturesScanned: 0,
        moves: 0,
        inserted: 0,
        failedTxs: 0,
        error: (err as Error).message,
      }
      failed++
    }
  }

  const gainsResults: { entity: string; totals: Record<string, number>; error?: string }[] = []
  for (const dbEntity of entitiesWithInserts) {
    const displayEntity = toDisplayEntity(dbEntity)
    try {
      const { totals } = await recomputeEntityGains(displayEntity)
      gainsResults.push({ entity: displayEntity, totals })
    } catch (e) {
      gainsResults.push({ entity: displayEntity, totals: {}, error: e instanceof Error ? e.message : String(e) })
    }
  }
  console.log(`[fetch-tx] gains recompute: ${gainsResults.map(g => `${g.entity}={${Object.entries(g.totals).map(([k,v])=>`${k}:${v}`).join(',')}}${g.error ? ` ERR:${g.error}` : ''}`).join(', ')}`)

  const elapsedMs = Date.now() - jobStartedAt
  console.log(`[fetch-tx] job done: ${wallets.length} wallets, ${totalInserted} rows inserted, ${failed} failed, ${elapsedMs}ms`)
  return { ok: true, wallets: wallets.length, inserted: totalInserted, failed, mode: opts.full ? 'full' : 'incremental', elapsedMs, results }
}
