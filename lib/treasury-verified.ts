import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { FOCUS_TOKENS, PRICE_MINTS } from '@/lib/constants'
import { RateLimiter } from '@/lib/rate-limiter'

// A historical balance is queried for every tracked mint, including zeroes.
// The completed set is saved atomically; an interrupted request cannot create
// a seemingly complete portfolio. This cache is separate from the daily RPC
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

const limiter = new RateLimiter(8, 8)
const SOL_MINT = 'So11111111111111111111111111111111111111111'

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
      if (!response.ok) {
        if (![429, 502, 503, 504].includes(response.status) || attempt === 3) {
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
      if (attempt === 3 || (err instanceof Error && /HTTP (400|401|403|404)|Invalid Helius/.test(err.message))) throw err
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
  const expectedKeys = new Set(ordered.flatMap((address) => FOCUS_TOKENS.map((token) => `${address}:${token}`)))
  const saved = row?.balances as HistoricalBalance[] | undefined
  if (row && JSON.stringify(row.wallet_addresses) === JSON.stringify(ordered) &&
      Array.isArray(saved) && saved.length === expectedKeys.size &&
      saved.every((entry) => expectedKeys.delete(`${entry.walletAddress}:${entry.token}`)) &&
      expectedKeys.size === 0) {
    return { balances: saved, fetchedAt: new Date(row.fetched_at as string | Date).toISOString(), cached: true }
  }

  const tasks = ordered.flatMap((address) => FOCUS_TOKENS.map((token) => ({ address, token })))
  const results = new Array<HistoricalBalance>(tasks.length)
  let cursor = 0
  // Bound concurrent requests and fail the whole report when any one fails.
  await Promise.all(Array.from({ length: Math.min(8, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++
      const task = tasks[index]
      results[index] = await balanceAt(task.address, task.token, Math.floor(endOfDay / 1000))
    }
  }))
  const fetchedAt = new Date()
  await db.execute(sql`
    INSERT INTO app.treasury_verified_snapshot (date, wallet_addresses, balances, fetched_at)
    VALUES (${date}::date, ${JSON.stringify(ordered)}::jsonb, ${JSON.stringify(results)}::jsonb, ${fetchedAt})
    ON CONFLICT (date) DO UPDATE SET wallet_addresses = EXCLUDED.wallet_addresses,
      balances = EXCLUDED.balances, fetched_at = EXCLUDED.fetched_at
  `)
  return { balances: results, fetchedAt: fetchedAt.toISOString(), cached: false }
}
