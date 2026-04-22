import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, transaction } from '@/lib/db/schema'
import { heliusRpc } from '@/lib/helius'
import { FOCUS_SET, STABLE_TOKENS, getSym } from '@/lib/constants'

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
}

/**
 * Decode a Helius-returned full transaction into one or more normalized movements.
 * Extracts SOL deltas from pre/post balances and token deltas from pre/post token balances
 * for focus tokens only (SOL, ORCA, USDC, USDT).
 */
function parseTransaction(
  tx: any,
  walletAddress: string,
  entityId: string,
): ParsedMove[] {
  if (!tx?.meta) return []
  const meta = tx.meta
  const keys = (tx.transaction?.message?.accountKeys || []).map(
    (k: any) => (typeof k === 'string' ? k : k.pubkey),
  )
  const walletIdx = keys.indexOf(walletAddress)
  const blockTimeUnix = tx.blockTime
  if (!blockTimeUnix) return []
  const blockTime = new Date(blockTimeUnix * 1000)
  const sig = tx.transaction?.signatures?.[0] || ''
  const moves: ParsedMove[] = []

  // SOL delta
  if (walletIdx >= 0) {
    const pre = (meta.preBalances?.[walletIdx] || 0) / 1e9
    const post = (meta.postBalances?.[walletIdx] || 0) / 1e9
    const fee = (meta.fee || 0) / 1e9
    const delta = post - pre + fee
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
      })
    }
  }

  // Token deltas
  const preMap: Record<string, number> = {}
  const postMap: Record<string, number> = {}
  for (const b of (meta.preTokenBalances || [])) {
    if (b.owner === walletAddress) {
      preMap[b.mint] = (preMap[b.mint] || 0) + parseFloat(b.uiTokenAmount?.uiAmountString || '0')
    }
  }
  for (const b of (meta.postTokenBalances || [])) {
    if (b.owner === walletAddress) {
      postMap[b.mint] = (postMap[b.mint] || 0) + parseFloat(b.uiTokenAmount?.uiAmountString || '0')
    }
  }

  for (const mint of new Set([...Object.keys(preMap), ...Object.keys(postMap)])) {
    const sym = getSym(mint)
    if (!sym || !FOCUS_SET.has(sym)) continue
    const delta = (postMap[mint] || 0) - (preMap[mint] || 0)
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
    })
  }

  return moves
}

type WalletResult = {
  ok: boolean
  signaturesScanned: number
  moves: number
  inserted: number
  error?: string
}

const SIG_PAGE = 100
const MAX_PAGES_PER_WALLET_INCREMENTAL = 10   // ~1000 signatures per run per wallet (safety net)
const TX_CONCURRENCY = 3                      // concurrent getTransaction calls; free tier is ~10 rps

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

async function processWallet(
  walletRow: typeof wallet.$inferSelect,
  opts: { full?: boolean; logPrefix?: string } = {},
): Promise<WalletResult> {
  const prefix = opts.logPrefix ?? `[fetch-tx ${walletRow.entityId} ${shortAddr(walletRow.address)}]`
  const startedAt = Date.now()

  // Incremental mode: use `until=<latest-known-signature>` so Helius stops
  // server-side at our high-water mark. Full-backfill mode skips it entirely
  // and drains the wallet until Helius returns an empty page.
  let untilSig: string | null = null
  if (!opts.full) {
    const [latest] = await db.select({ txHash: transaction.txHash })
      .from(transaction)
      .where(eq(transaction.walletAddress, walletRow.address))
      .orderBy(desc(transaction.blockTime))
      .limit(1)
    untilSig = latest?.txHash ?? null
  }

  const pageCap = opts.full ? Number.MAX_SAFE_INTEGER : MAX_PAGES_PER_WALLET_INCREMENTAL
  console.log(`${prefix} start mode=${opts.full ? 'full' : 'incremental'}${untilSig ? ` until=${untilSig.slice(0, 8)}…` : ''}`)

  let before: string | null = null
  let scanned = 0
  let inserted = 0
  let moves = 0

  for (let page = 0; page < pageCap; page++) {
    const pageOpts: Record<string, unknown> = { limit: SIG_PAGE }
    if (before) pageOpts.before = before
    if (untilSig) pageOpts.until = untilSig

    const sigRes = await heliusRpc('getSignaturesForAddress', [walletRow.address, pageOpts])
    const sigs: any[] = sigRes?.result || []
    if (sigs.length === 0) break

    const toFetch: string[] = []
    for (const s of sigs) {
      scanned++
      if (s.err) continue
      toFetch.push(s.signature)
    }

    let pageInserted = 0

    // Free tier blocks batch requests (-32403), so call getTransaction
    // per-signature with small concurrency. Rate limiter paces globally.
    for (let i = 0; i < toFetch.length; i += TX_CONCURRENCY) {
      const chunk = toFetch.slice(i, i + TX_CONCURRENCY)
      const txs = await Promise.all(chunk.map((sig) =>
        heliusRpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }])
          .then((r: any) => r?.result)
          .catch(() => null),
      ))

      for (const tx of txs) {
        if (!tx) continue
        const parsed = parseTransaction(tx, walletRow.address, walletRow.entityId)
        moves += parsed.length
        for (const m of parsed) {
          const res = await db.insert(transaction).values({
            txHash: m.txHash,
            walletAddress: m.walletAddress,
            entityId: m.entityId,
            blockTime: m.blockTime,
            asset: m.asset,
            qty: String(m.qty),
            direction: m.direction,
            price: m.price != null ? String(m.price) : null,
            usd: m.usd != null ? String(m.usd) : null,
            priceSource: m.priceSource,
          }).onConflictDoNothing().returning()
          if (res.length > 0) {
            inserted++
            pageInserted++
          }
        }
      }
    }

    const oldestTime = sigs[sigs.length - 1]?.blockTime
    const oldestDate = oldestTime ? new Date(oldestTime * 1000).toISOString().slice(0, 10) : '?'
    console.log(`${prefix}   page ${page + 1}: +${sigs.length} sigs (total ${scanned}), +${pageInserted} rows, oldest=${oldestDate}`)

    before = sigs[sigs.length - 1]?.signature ?? null
    if (!before) break
  }

  const elapsedMs = Date.now() - startedAt
  console.log(`${prefix} done: ${scanned} scanned, ${moves} moves, ${inserted} inserted in ${elapsedMs}ms`)
  return { ok: true, signaturesScanned: scanned, moves, inserted }
}

/**
 * Cron: pull new signatures per Orca-owned wallet since last-seen, parse into
 * movements, upsert into `transaction` with unique-constraint dedup.
 *
 * Pass `{ full: true }` to ignore the incremental `until` cursor and page cap —
 * drains full wallet history until Helius returns no more signatures. Intended
 * for one-shot historical backfills; don't use on the recurring cron schedule.
 */
export async function fetchTransactionsJob(opts: { full?: boolean } = {}) {
  const wallets = await db.select().from(wallet).where(eq(wallet.isExternal, false))
  const results: Record<string, WalletResult> = {}
  let totalInserted = 0
  let failed = 0

  console.log(`[fetch-tx] job start: ${wallets.length} wallets, mode=${opts.full ? 'full' : 'incremental'}`)
  const jobStartedAt = Date.now()

  for (let idx = 0; idx < wallets.length; idx++) {
    const w = wallets[idx]
    const logPrefix = `[fetch-tx ${idx + 1}/${wallets.length} ${w.entityId} ${shortAddr(w.address)}]`
    try {
      const r = await processWallet(w, { ...opts, logPrefix })
      results[w.address] = r
      totalInserted += r.inserted
    } catch (err) {
      results[w.address] = {
        ok: false,
        signaturesScanned: 0,
        moves: 0,
        inserted: 0,
        error: (err as Error).message,
      }
      failed++
    }
  }

  const elapsedMs = Date.now() - jobStartedAt
  console.log(`[fetch-tx] job done: ${wallets.length} wallets, ${totalInserted} rows inserted, ${failed} failed, ${elapsedMs}ms`)
  return { ok: true, wallets: wallets.length, inserted: totalInserted, failed, mode: opts.full ? 'full' : 'incremental', elapsedMs, results }
}
