// One-off historical balance_snapshot backfill via Helius getTransfersByAddress.
//
// Per (wallet, mint):
//   1. Paginate ALL transfers (solMode=merged, treats WSOL as SOL).
//   2. Walk chronologically, accumulate running balance.
//   3. Forward-fill across calendar days (matches what the daily cron writes).
//   4. Dust filter: skip if current_balance * current_price < $0.01.
//   5. Resolve mint → symbol (KNOWN_MINTS first; otherwise the transfer's own
//      symbol metadata, auto-upserted into app.token so the FK holds).
//   6. Insert into app.balance_snapshot with ON CONFLICT DO NOTHING — so we
//      never clobber the daily cron's authoritative rows from 2026-04-21 onward.
//
// Self-contained Helius client + rate limiter so this script doesn't perturb
// the shared limiter in lib/helius.ts that the daily cron + other tools use.
//
// Usage:
//   bun scripts/backfill-balances.ts --wallet=<addr> --dry-run         # safest: one wallet, no DB writes
//   bun scripts/backfill-balances.ts --wallet=<addr>                   # one wallet, real writes
//   bun scripts/backfill-balances.ts                                   # all internal SOL wallets
//   bun scripts/backfill-balances.ts --since=2025-01-01                # bound earliest blockTime
//
// Env:
//   HELIUS_API_KEY                  required
//   BACKFILL_HELIUS_RPS             default 10 — only this script's RPC budget
//   DUST_THRESHOLD_USD              default 0.01 — (wallet, token) pairs under this are skipped entirely

// Bun auto-loads .env / .env.local from cwd, no dotenv import needed.
import { db } from '../lib/db'
import { wallet as walletTbl, token as tokenTbl, balanceSnapshot } from '../lib/db/schema'
import { auditLog } from '../lib/db/schema/audit'
import { and, eq, sql, desc } from 'drizzle-orm'
import { KNOWN_MINTS, STABLE_TOKENS } from '../lib/constants'
import { getCurrentPrices } from '../lib/defillama'

// ---------- args ----------

const args = process.argv.slice(2)
const argValue = (k: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${k}=`))
  return a ? a.slice(k.length + 3) : undefined
}
const walletFilter = argValue('wallet')
const sinceArg = argValue('since')  // YYYY-MM-DD inclusive
const isDryRun = args.includes('--dry-run')
const forceReBackfill = args.includes('--force')   // ignore "already backfilled" check

// Cron started writing balance_snapshot on 2026-04-21. Any wallet with a
// snapshot row dated before this has already been backfilled and we skip it
// unless --force is passed.
const CRON_START_DATE = '2026-04-21'

const HELIUS_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || ''
if (!HELIUS_KEY) {
  console.error('error: HELIUS_API_KEY missing — load .env.local')
  process.exit(1)
}
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
const RPS = Number.parseInt(process.env.BACKFILL_HELIUS_RPS || '10', 10)
const DUST_USD = Number.parseFloat(process.env.DUST_THRESHOLD_USD || '0.01')

// ---------- self-contained rate-limited RPC ----------

let lastTick = 0
async function throttle() {
  const minInterval = 1000 / RPS
  const wait = lastTick + minInterval - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastTick = Date.now()
}

let rpcId = 1
async function rpc(method: string, params: unknown[]): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle()
    const t0 = Date.now()
    try {
      const tag = method + (attempt > 0 ? ` retry#${attempt}` : '')
      process.stderr.write(`  [rpc] → ${tag}…`)
      const r = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
      })
      process.stderr.write(` (${Date.now() - t0}ms, http=${r.status})\n`)
      if (r.status === 429) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 30000)
        console.warn(`[rpc] 429 on ${method}, waiting ${wait}ms (attempt ${attempt + 1})`)
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      const data = await r.json()
      if (data?.error?.code === -32413 || data?.error?.code === -32029) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 30000)
        console.warn(`[rpc] rpc rate-limit ${data.error.code} ${data.error.message}, waiting ${wait}ms`)
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      if (data?.error) {
        throw new Error(`${method} error: ${JSON.stringify(data.error)}`)
      }
      return data.result
    } catch (e) {
      if (attempt === 4) throw e
      console.warn(`[rpc] ${method} threw: ${(e as Error).message} (attempt ${attempt + 1})`)
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
    }
  }
}

// ---------- gTFA: getTransactionsForAddress + balance-change extraction ----------

// One balance change per (signature, mint) for our wallet.
type BalanceChange = {
  signature: string
  blockTime: number   // unix seconds
  mintKey: string     // SOL_NATIVE_MARKER or the SPL mint
  decimals: number
  delta: number       // signed UI amount (positive = received, negative = sent/fee'd)
}

const WSOL_MINT = 'So11111111111111111111111111111111111111112'

function classifyMint(mint: string | null | undefined): string {
  if (!mint || mint === '11111111111111111111111111111111' || mint === WSOL_MINT) return SOL_NATIVE_MARKER
  return mint
}

async function* iterateBalanceChanges(address: string, sinceUnixSec?: number): AsyncGenerator<BalanceChange> {
  let paginationToken: string | undefined = undefined
  let pageCount = 0
  let totalTxCount = 0
  let totalChangeCount = 0

  while (true) {
    // gTFA params: [address_string, options_object] per Helius docs.
    // tokenAccounts + blockTime live inside `filters`. sortOrder (not "sort"),
    // and transactionDetails: "full" is required to get the meta.pre/postBalances.
    const filters: Record<string, unknown> = { tokenAccounts: 'balanceChanged' }
    if (sinceUnixSec) filters.blockTime = { gte: sinceUnixSec }
    const opts: Record<string, unknown> = {
      transactionDetails: 'full',
      sortOrder: 'asc',
      limit: 500,
      filters,
    }
    if (paginationToken) opts.paginationToken = paginationToken

    const res = await rpc('getTransactionsForAddress', [address, opts])
    if (pageCount === 0 && process.env.BACKFILL_DEBUG === '1') {
      console.error(`[gtfa debug] first response top-level keys: ${Object.keys(res ?? {}).join(', ')}`)
      console.error(`[gtfa debug] first response sample (first 800 chars): ${JSON.stringify(res ?? {}).slice(0, 800)}`)
    }
    const txs: any[] = Array.isArray(res)
      ? res
      : res?.transactions ?? res?.data ?? res?.items ?? []
    pageCount++
    totalTxCount += txs.length

    for (const tx of txs) {
      const blockTime = Number(tx.blockTime ?? tx.transaction?.blockTime ?? 0)
      const signature = tx.signature ?? tx.transaction?.signatures?.[0] ?? ''
      const meta = tx.meta ?? tx.transaction?.meta ?? {}
      // accountKeys can be array of strings OR array of objects with .pubkey
      const accountKeysRaw: any[] = tx.transaction?.message?.accountKeys ?? tx.accountKeys ?? []
      const accountKeys: string[] = accountKeysRaw.map((k) => (typeof k === 'string' ? k : k?.pubkey ?? k?.address ?? ''))

      // 1) Native SOL delta — only if our wallet appears in accountKeys (as fee
      //    payer, signer, or referenced account that has lamport changes).
      const walletIdx = accountKeys.indexOf(address)
      if (walletIdx >= 0 && Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)) {
        const pre = BigInt(meta.preBalances[walletIdx] ?? 0)
        const post = BigInt(meta.postBalances[walletIdx] ?? 0)
        const deltaLamports = post - pre
        if (deltaLamports !== BigInt(0)) {
          yield {
            signature,
            blockTime,
            mintKey: SOL_NATIVE_MARKER,
            decimals: 9,
            delta: Number(deltaLamports) / 1e9,
          }
          totalChangeCount++
        }
      }

      // 2) SPL token deltas — sum across all token accounts owned by our wallet,
      //    grouped by mint. WSOL mint collapses into SOL_NATIVE_MARKER so a
      //    wrap/unwrap reduces to a net delta of -rent_fee on the SOL bucket.
      const prePerMint = new Map<string, { raw: bigint; decimals: number }>()
      const postPerMint = new Map<string, { raw: bigint; decimals: number }>()
      for (const entry of meta.preTokenBalances ?? []) {
        if (entry.owner !== address) continue
        const m = classifyMint(entry.mint)
        const raw = BigInt(entry.uiTokenAmount?.amount ?? 0)
        const decimals = Number(entry.uiTokenAmount?.decimals ?? 0)
        const existing = prePerMint.get(m) ?? { raw: BigInt(0), decimals }
        prePerMint.set(m, { raw: existing.raw + raw, decimals: existing.decimals || decimals })
      }
      for (const entry of meta.postTokenBalances ?? []) {
        if (entry.owner !== address) continue
        const m = classifyMint(entry.mint)
        const raw = BigInt(entry.uiTokenAmount?.amount ?? 0)
        const decimals = Number(entry.uiTokenAmount?.decimals ?? 0)
        const existing = postPerMint.get(m) ?? { raw: BigInt(0), decimals }
        postPerMint.set(m, { raw: existing.raw + raw, decimals: existing.decimals || decimals })
      }
      const allMints = new Set([...prePerMint.keys(), ...postPerMint.keys()])
      for (const m of allMints) {
        // Skip SOL_NATIVE_MARKER here — native SOL already counted via preBalances/postBalances above.
        // The WSOL token-balance leg of a wrap would otherwise double-count if we didn't skip.
        if (m === SOL_NATIVE_MARKER) continue
        const pre = prePerMint.get(m)
        const post = postPerMint.get(m)
        const decimals = pre?.decimals ?? post?.decimals ?? 0
        const deltaRaw = (post?.raw ?? BigInt(0)) - (pre?.raw ?? BigInt(0))
        if (deltaRaw === BigInt(0)) continue
        yield {
          signature,
          blockTime,
          mintKey: m,
          decimals,
          delta: Number(deltaRaw) / 10 ** decimals,
        }
        totalChangeCount++
      }
    }

    paginationToken = res?.paginationToken ?? undefined
    if (!paginationToken) break
  }
  console.error(`[gtfa] ${address.slice(0, 4)}…${address.slice(-4)}  pages=${pageCount}  txs=${totalTxCount}  changes=${totalChangeCount}`)
}

// ---------- balance reconstruction ----------

const SOL_NATIVE_MARKER = 'native'  // synthetic mint key for native SOL inside this script

type DailyBalance = { date: string; amount: number }
type PerTokenHistory = {
  mintKey: string           // SOL_NATIVE_MARKER or the SPL mint
  symbol: string            // resolved symbol (SOL, USDC, ORCA, …)
  decimals: number
  transferCount: number
  firstActivity: string | null
  lastActivity: string | null
  currentBalance: number    // UI-scaled (post-decimals)
  dailyHistory: DailyBalance[]  // forward-filled, dense, sorted ASC
}

function isoDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10)
}

function resolveSymbol(mintKey: string): string | null {
  if (mintKey === SOL_NATIVE_MARKER) return 'SOL'
  const known = KNOWN_MINTS[mintKey]
  if (known) return known
  return null  // unknown — caller decides whether to skip
}

async function reconstructHistory(address: string, sinceUnixSec?: number): Promise<PerTokenHistory[]> {
  // Per-mint streams of balance changes (signed deltas, already adjusted for fees etc.)
  const byMint = new Map<string, { changes: BalanceChange[]; decimals: number }>()

  for await (const c of iterateBalanceChanges(address, sinceUnixSec)) {
    const entry = byMint.get(c.mintKey) ?? { changes: [], decimals: c.decimals }
    // Some token accounts may report decimals=0 in pre/postTokenBalances when
    // the account is created mid-tx; trust the first non-zero we see.
    if (entry.decimals === 0 && c.decimals > 0) entry.decimals = c.decimals
    entry.changes.push(c)
    byMint.set(c.mintKey, entry)
  }

  const today = isoDate(Math.floor(Date.now() / 1000))
  const histories: PerTokenHistory[] = []

  for (const [mintKey, { changes, decimals }] of byMint.entries()) {
    changes.sort((a, b) => a.blockTime - b.blockTime)
    if (changes.length === 0) continue

    // Walk chronologically. Each change is already a signed delta from
    // meta.pre/postBalances — just sum.
    const perDayEnd = new Map<string, number>()
    let balance = 0
    let firstActivity: string | null = null
    for (const c of changes) {
      balance += c.delta
      const d = isoDate(c.blockTime)
      perDayEnd.set(d, balance)  // last write of the day wins → end-of-day balance
      if (!firstActivity) firstActivity = d
    }
    const lastActivity = isoDate(changes[changes.length - 1].blockTime)
    const currentBalance = balance

    // Forward-fill: between firstActivity and today, every date carries the
    // most recent end-of-day balance.
    const dailyHistory: DailyBalance[] = []
    if (firstActivity) {
      const start = new Date(`${firstActivity}T00:00:00Z`)
      const end = new Date(`${today}T00:00:00Z`)
      let last = 0
      for (let cur = start.getTime(); cur <= end.getTime(); cur += 86_400_000) {
        const d = new Date(cur).toISOString().slice(0, 10)
        if (perDayEnd.has(d)) last = perDayEnd.get(d)!
        dailyHistory.push({ date: d, amount: last })
      }
    }

    histories.push({
      mintKey,
      symbol: resolveSymbol(mintKey) ?? `unknown:${mintKey.slice(0, 4)}…${mintKey.slice(-4)}`,
      decimals,
      transferCount: changes.length,
      firstActivity,
      lastActivity,
      currentBalance,
      dailyHistory,
    })
  }
  return histories
}

// ---------- dust filter ----------

async function priceFor(symbol: string, currentPrices: Record<string, number>): Promise<number> {
  if (STABLE_TOKENS.has(symbol)) return 1
  if (symbol === 'SOL' || symbol === 'ORCA' || symbol === 'USDC' || symbol === 'USDT' || symbol === 'PYUSD' || symbol === 'USDG') {
    return currentPrices[symbol] ?? (STABLE_TOKENS.has(symbol) ? 1 : 0)
  }
  // Unknown — no price, dust filter will drop unless price>0 later
  return 0
}

// ---------- ensure token row exists ----------

async function ensureTokenExists(symbol: string, decimals: number, mintKey: string): Promise<boolean> {
  if (isDryRun) return true
  const existing = await db.select({ symbol: tokenTbl.symbol }).from(tokenTbl).where(eq(tokenTbl.symbol, symbol)).limit(1)
  if (existing.length > 0) return true
  // Auto-upsert with name=symbol; coinId left null so we don't accidentally
  // claim a DefiLlama mapping we don't actually have.
  try {
    await db.insert(tokenTbl).values({
      symbol,
      name: symbol,
      decimals,
      coinId: null,
    }).onConflictDoNothing()
    console.error(`[token] auto-added: ${symbol} (decimals=${decimals}, source mint=${mintKey.slice(0, 6)}…)`)
    return true
  } catch (e) {
    console.error(`[token] failed to insert ${symbol}: ${(e as Error).message}`)
    return false
  }
}

// ---------- main ----------

const COMPLETION_ACTION = 'backfill.balance.completed'

/**
 * Has this wallet ever been marked "complete" by a previous backfill run?
 *
 * Critical distinction: presence of pre-cron `balance_snapshot` rows is NOT
 * sufficient (a partial/aborted run could have written some but not all
 * history). Only the audit_log marker, written ONLY after a wallet's full
 * reconstruction completes without error, definitively marks completion.
 *
 * Result: a crash mid-wallet leaves no marker → next run re-processes it.
 * A clean run leaves the marker → next run skips it (unless --force).
 */
async function alreadyBackfilled(address: string): Promise<boolean> {
  if (isDryRun) return false  // dry-run never skips — useful for re-verification
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(
      eq(auditLog.action, COMPLETION_ACTION),
      sql`${auditLog.metadata} ->> 'address' = ${address}`,
    ))
    .orderBy(desc(auditLog.createdAt))
    .limit(1)
  return rows.length > 0
}

async function markCompleted(address: string, label: string, summary: { rowsWritten: number; tokensKept: number; tokensSkipped: number }): Promise<void> {
  if (isDryRun) return
  try {
    await db.insert(auditLog).values({
      userId: null,
      action: COMPLETION_ACTION,
      metadata: {
        address,
        label,
        rowsWritten: summary.rowsWritten,
        tokensKept: summary.tokensKept,
        tokensSkipped: summary.tokensSkipped,
        source: 'scripts/backfill-balances.ts',
      },
    })
  } catch (e) {
    // Non-fatal: if audit_log insert fails we'll just re-process this wallet
    // on the next run. Better than dying on a successful backfill.
    console.warn(`  [warn] failed to write completion marker: ${(e as Error).message}`)
  }
}

async function backfillWallet(address: string, label: string, currentPrices: Record<string, number>): Promise<'ok' | 'skipped' | 'error'> {
  console.error(`\n=== ${label} (${address}) ===`)

  if (!forceReBackfill && (await alreadyBackfilled(address))) {
    console.error('  [skip] previously completed (audit_log marker present) — pass --force to re-process')
    return 'skipped'
  }

  const sinceUnix = sinceArg ? Math.floor(new Date(`${sinceArg}T00:00:00Z`).getTime() / 1000) : undefined

  const histories = await reconstructHistory(address, sinceUnix)
  if (histories.length === 0) {
    console.error('  (no transfers found in range)')
    return 'ok'
  }

  let totalRowsKept = 0
  let totalRowsWritten = 0
  let kept = 0
  let skipped = 0

  for (const h of histories) {
    const price = await priceFor(h.symbol, currentPrices)
    const currentUsd = h.currentBalance * price
    const dustPass = currentUsd >= DUST_USD

    const ic = dustPass ? 'KEEP' : 'SKIP'
    console.log(
      `  [${ic}]  ${h.symbol.padEnd(10)}  qty=${h.currentBalance.toLocaleString('en-US', { maximumFractionDigits: 6 }).padStart(18)}  ` +
        `price=$${price.toFixed(4)}  usd=$${currentUsd.toFixed(2)}  ` +
        `transfers=${h.transferCount}  days=${h.dailyHistory.length}  ` +
        `(${h.firstActivity} → ${h.lastActivity})`,
    )

    if (!dustPass) {
      skipped++
      continue
    }
    kept++
    totalRowsKept += h.dailyHistory.length

    if (isDryRun) continue

    // Ensure token row + symbol resolution; bail on unresolved
    if (h.symbol.startsWith('unknown:')) {
      console.error(`  [warn] ${h.symbol} — no symbol resolved; skipping insert`)
      continue
    }
    const ok = await ensureTokenExists(h.symbol, h.decimals, h.mintKey)
    if (!ok) continue

    // Bulk insert with chunked batches
    const CHUNK = 500
    for (let i = 0; i < h.dailyHistory.length; i += CHUNK) {
      const chunk = h.dailyHistory.slice(i, i + CHUNK)
      const rows = chunk.map((d) => ({
        date: d.date,
        walletAddress: address,
        token: h.symbol,
        amount: d.amount.toString(),
        fetchedAt: new Date(),
      }))
      const inserted = await db
        .insert(balanceSnapshot)
        .values(rows)
        .onConflictDoNothing()
        .returning({ date: balanceSnapshot.date })
      totalRowsWritten += inserted.length
    }
  }

  console.log(
    `  ${isDryRun ? '[dry-run] would write' : 'wrote'} ${totalRowsKept} rows ` +
      `(${kept} tokens kept, ${skipped} dust-filtered)${isDryRun ? '' : ` — actually inserted ${totalRowsWritten} new rows after ON CONFLICT`}`,
  )

  // Write completion marker — ONLY reached if reconstruction + writes finished
  // without throwing. Anything that errored upstream propagates to the caller
  // (which catches it and records the wallet as failed without a marker).
  await markCompleted(address, label, { rowsWritten: totalRowsWritten, tokensKept: kept, tokensSkipped: skipped })

  return 'ok'
}

async function main() {
  console.error(`[backfill-balances] dry-run=${isDryRun}  rps=${RPS}  dust=$${DUST_USD}`)
  if (sinceArg) console.error(`[backfill-balances] since=${sinceArg}`)

  // Resolve wallet list
  type WalletRow = { address: string; label: string }
  let wallets: WalletRow[]
  if (walletFilter) {
    // In dry-run we don't need DB to resolve label
    if (isDryRun) {
      wallets = [{ address: walletFilter, label: '(dry-run) custom' }]
    } else {
      const rows = await db
        .select({ address: walletTbl.address, label: walletTbl.label })
        .from(walletTbl)
        .where(eq(walletTbl.address, walletFilter))
        .limit(1)
      if (rows.length === 0) {
        console.error(`[backfill-balances] wallet ${walletFilter} not found in app.wallet — refusing to write to unknown wallet`)
        process.exit(1)
      }
      wallets = rows
    }
  } else {
    if (isDryRun) {
      console.error(`[backfill-balances] dry-run on all wallets is noisy — pass --wallet=<addr> for first runs`)
    }
    const rows = await db
      .select({ address: walletTbl.address, label: walletTbl.label })
      .from(walletTbl)
      .where(and(eq(walletTbl.chain, 'SOL'), eq(walletTbl.type, 'internal'), eq(walletTbl.hiddenFromFinance, false)))
      .orderBy(
        sql`CASE
          WHEN ${walletTbl.entityId} = 'foundation' AND ${walletTbl.label} ILIKE '%FTX%' THEN 7
          WHEN ${walletTbl.label} ILIKE '%[Test]%' OR ${walletTbl.label} ILIKE '%Testing%' OR ${walletTbl.label} ILIKE '%Test Vault%' THEN 6
          WHEN ${walletTbl.label} ILIKE '%[Live]%' OR ${walletTbl.label} ILIKE '%PAMM%' OR ${walletTbl.label} ILIKE '%TreasureHunt%' THEN 5
          WHEN ${walletTbl.entityId} = 'juku' THEN 4
          WHEN ${walletTbl.entityId} = 'zagreus' THEN 3
          WHEN ${walletTbl.entityId} = 'opco' THEN 2
          WHEN ${walletTbl.entityId} = 'foundation' THEN 1
          ELSE 8
        END`,
        walletTbl.label,
      )
    wallets = rows
  }

  console.error(`[backfill-balances] processing ${wallets.length} wallet(s)`)

  // Fetch current prices once for the dust filter
  console.error(`[backfill-balances] fetching current prices for dust filter…`)
  const currentPrices = await getCurrentPrices(['SOL', 'ORCA', 'USDC', 'USDT', 'PYUSD', 'USDG'])

  // Per-wallet error isolation: one wallet failing does not abort the run.
  // Track outcomes for the end-of-run summary.
  const succeeded: string[] = []
  const skipped: string[] = []
  const failed: Array<{ address: string; label: string; reason: string }> = []

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i]
    console.error(`\n[${i + 1}/${wallets.length}] starting ${w.label}`)
    try {
      const outcome = await backfillWallet(w.address, w.label, currentPrices)
      if (outcome === 'skipped') skipped.push(w.address)
      else succeeded.push(w.address)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      console.error(`  [ERROR] ${w.label}: ${reason}`)
      failed.push({ address: w.address, label: w.label, reason })
    }
  }

  // End-of-run summary
  console.error(`\n${'='.repeat(60)}`)
  console.error(`[backfill-balances] FINAL SUMMARY`)
  console.error(`  succeeded: ${succeeded.length}`)
  console.error(`  skipped:   ${skipped.length}  (already backfilled — pass --force to re-process)`)
  console.error(`  failed:    ${failed.length}`)
  if (failed.length > 0) {
    console.error(`\n  Failed wallets — retry individually via --wallet=<addr>:`)
    for (const f of failed) {
      console.error(`    ${f.address}  ${f.label}`)
      console.error(`      → ${f.reason}`)
    }
  }
  console.error(`${'='.repeat(60)}\n`)

  process.exit(failed.length > 0 ? 2 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
