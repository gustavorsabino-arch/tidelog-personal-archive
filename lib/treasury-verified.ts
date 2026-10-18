import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { FOCUS_TOKENS, PRICE_MINTS } from '@/lib/constants'
import { RateLimiter } from '@/lib/rate-limiter'

// A historical balance is queried for every tracked mint, including zeroes.
// A partial set is checkpointed, but only the completed set is returned as a
// portfolio. This cache is separate from the daily RPC
// snapshots and from manually entered bank/protocol positions.
const DDL = `CREATE TABLE IF NOT EXISTS "app"."treasury_verified_snapshot" (
  "date" date PRIMARY KEY NOT NULL,
  "wallet_addresses" jsonb NOT NULL,
  "balances" jsonb NOT NULL,
  "fetched_at" timestamptz DEFAULT now() NOT NULL
)`

export type HistoricalBalance = {
  walletAddress: string
  token: string
  amount: string
  slot: number | null
  signature: string | null
}

let tableReady: Promise<void> | null = null
async function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      const probe = await db.execute(sql`SELECT to_regclass('app.treasury_verified_snapshot') AS name`)
      if (!probe[0]?.name) await db.execute(sql.raw(DDL))
    })().catch((err) => { tableReady = null; throw err })
  }
  return tableReady
}

// Wallet API has its own throttle; the RPC limit does not apply here.
const limiter = new RateLimiter(1, 2, 1000)
const BATCH_SIZE = 40
const SOL_MINT = 'So11111111111111111111111111111111111111111'

export class HistoricalBalanceProgress extends Error {
  constructor(public completed: number, public total: number, public retryAfterMs = 1000) {
    super('Historical balances are being verified')
  }
}

class HeliusThrottle extends Error {
  constructor(public retryAfterMs: number) { super('Helius is limiting historical balance requests') }
}

async function balanceAt(address: string, token: string, unix: number): Promise<HistoricalBalance> {
  const key = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY
  if (!key) throw new Error('Historical on-chain balance source is not configured')
  const mint = token === 'SOL' ? SOL_MINT : PRICE_MINTS[token]
  if (!mint) throw new Error(`Missing mint for ${token}`)
  const url = new URL(`https://api.helius.xyz/v1/wallet/${encodeURIComponent(address)}/balance-at`)
  url.searchParams.set('mint', mint)
  url.searchParams.set('time', String(unix))
  for (let attempt = 0; attempt < 4; attempt++) {
    await limiter.acquire()
    try {
      const response = await fetch(url, {
        headers: { 'X-Api-Key': key },
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      })
      if (response.status === 429) {
        const header = response.headers.get('retry-after')
        const seconds = header && /^\d+$/.test(header) ? Number(header) * 1000 : NaN
        const date = header && !Number.isFinite(seconds) ? Date.parse(header) - Date.now() : NaN
        throw new HeliusThrottle(Math.max(30_000, Math.min(300_000,
          Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? date : 60_000)))
      }
      if (!response.ok) {
        if (![502, 503, 504].includes(response.status) || attempt === 3) {
          throw new Error(`Helius historical balance HTTP ${response.status} for ${token}`)
        }
      } else {
        const data = await response.json() as {
          wallet?: string; mint?: string; balance?: string; balanceRaw?: string;
          asOf?: { slot: number; signature: string } | null
        }
        if (data.wallet !== address || data.mint !== mint ||
            typeof data.balance !== 'string' || !/^\d+(\.\d+)?$/.test(data.balance) ||
            typeof data.balanceRaw !== 'string' || !/^\d+$/.test(data.balanceRaw) ||
            (data.asOf != null && (!Number.isSafeInteger(data.asOf.slot) || !data.asOf.signature))) {
          throw new Error(`Invalid Helius historical balance response for ${token}`)
        }
        return { walletAddress: address, token, amount: data.balance,
          slot: data.asOf?.slot ?? null, signature: data.asOf?.signature ?? null }
      }
    } catch (err) {
      if (err instanceof HeliusThrottle || attempt === 3 ||
          (err instanceof Error && /HTTP (400|401|403|404)|Invalid Helius/.test(err.message))) throw err
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
  }
  throw new Error(`Historical balance unavailable for ${token}`)
}

export async function getVerifiedHistoricalBalances(date: string, addresses: string[]) {
  const endOfDay = Date.parse(`${date}T23:59:59Z`)
  if (!Number.isFinite(endOfDay) || new Date(endOfDay).toISOString().slice(0, 10) !== date || endOfDay > Date.now()) {
    throw new Error('Select a completed UTC date for historical on-chain balances')
  }
  await ensureTable()
  const ordered = [...addresses].sort()
  const cached = await db.execute(sql`
    SELECT wallet_addresses, balances, fetched_at
    FROM app.treasury_verified_snapshot WHERE date = ${date}::date
  `)
  const row = cached[0]
  const tasks = ordered.flatMap((address) => FOCUS_TOKENS.map((token) => ({ address, token })))
  const expectedKeys = new Set(tasks.map(({ address, token }) => `${address}:${token}`))
  const sameWallets = row && JSON.stringify(row.wallet_addresses) === JSON.stringify(ordered)
  const saved = sameWallets && Array.isArray(row.balances) ? row.balances as HistoricalBalance[] : []
  const byKey = new Map<string, HistoricalBalance>()
  for (const entry of saved) {
    if (entry && expectedKeys.has(`${entry.walletAddress}:${entry.token}`) &&
        typeof entry.amount === 'string' && /^\d+(\.\d+)?$/.test(entry.amount)) {
      byKey.set(`${entry.walletAddress}:${entry.token}`, entry)
    }
  }
  if (byKey.size === tasks.length) {
    return { balances: tasks.map(({ address, token }) => byKey.get(`${address}:${token}`)!),
      fetchedAt: new Date(row.fetched_at as string | Date).toISOString(), cached: true }
  }

  const pending = tasks.filter(({ address, token }) => !byKey.has(`${address}:${token}`))
  let throttle: HeliusThrottle | null = null
  let failure: unknown = null
  // Keep each invocation short enough for a serverless request. Resume the
  // remaining pairs on the next poll; zero balances are checkpoints too.
  for (const task of pending.slice(0, BATCH_SIZE)) {
    try {
      const result = await balanceAt(task.address, task.token, Math.floor(endOfDay / 1000))
      byKey.set(`${task.address}:${task.token}`, result)
    } catch (err) {
      if (err instanceof HeliusThrottle) throttle = err
      else failure = err
      break
    }
  }
  const fetchedAt = new Date()
  const results = tasks.flatMap(({ address, token }) => {
    const result = byKey.get(`${address}:${token}`)
    return result ? [result] : []
  })
  await db.execute(sql`
    INSERT INTO app.treasury_verified_snapshot (date, wallet_addresses, balances, fetched_at)
    VALUES (${date}::date, ${JSON.stringify(ordered)}::jsonb, ${JSON.stringify(results)}::jsonb, ${fetchedAt.toISOString()}::timestamptz)
    ON CONFLICT (date) DO UPDATE SET wallet_addresses = EXCLUDED.wallet_addresses,
      balances = EXCLUDED.balances, fetched_at = EXCLUDED.fetched_at
  `)
  if (failure) throw failure
  if (results.length !== tasks.length) {
    throw new HistoricalBalanceProgress(results.length, tasks.length, throttle?.retryAfterMs ?? 1000)
  }
  return { balances: results, fetchedAt: fetchedAt.toISOString(), cached: false }
}
