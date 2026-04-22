/**
 * DB-backed price cache.
 *
 * Reads from the `price` table first; falls back to DeFiLlama and
 * upserts the result so subsequent reads are fast.
 *
 * - `getLatestPrice`: last known price for a token (no fallback — returns null if not cached)
 * - `getPriceAt`: price at a specific timestamp (DB-first, API on miss)
 * - `upsertPrice`: internal write helper also used by the fetch-prices cron
 */

import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { price, token as tokenTable } from '@/lib/db/schema'
import { getCurrentPrices, getHistoricalPrice } from '@/lib/defillama'

const ONE_HOUR = 60 * 60 * 1000

/**
 * Return the latest cached `latest` price for a token, or null if nothing cached.
 */
export async function getLatestPrice(symbol: string): Promise<number | null> {
  const [row] = await db.select({ price: price.price })
    .from(price)
    .where(and(eq(price.token, symbol), eq(price.source, 'latest')))
    .orderBy(desc(price.timestamp))
    .limit(1)
  return row ? Number(row.price) : null
}

/**
 * Return the best price for a token at the given timestamp.
 * Tries DB cache (±1 hour window for historical rows) before hitting DeFiLlama.
 * On API hit, caches the result as `historical` for future reads.
 */
export async function getPriceAt(symbol: string, at: Date): Promise<number | null> {
  const windowStart = new Date(at.getTime() - ONE_HOUR)
  const windowEnd = new Date(at.getTime() + ONE_HOUR)

  const [cached] = await db.select({ price: price.price })
    .from(price)
    .where(and(
      eq(price.token, symbol),
      gte(price.timestamp, windowStart),
      lte(price.timestamp, windowEnd),
    ))
    .orderBy(desc(price.timestamp))
    .limit(1)

  if (cached) return Number(cached.price)

  // Cache miss — fall back to DeFiLlama
  const unix = Math.floor(at.getTime() / 1000)
  const apiPrice = await getHistoricalPrice(symbol, unix)
  if (apiPrice == null) return null

  await upsertPrice({
    token: symbol,
    timestamp: at,
    price: apiPrice,
    source: 'historical',
  })
  return apiPrice
}

export type PriceRow = {
  token: string
  timestamp: Date
  price: number
  source: 'latest' | 'historical'
}

/**
 * Insert-or-no-op on composite PK `(token, timestamp)`.
 * If the exact row already exists, the attempt is silently skipped — historical
 * prices are immutable.
 */
export async function upsertPrice(row: PriceRow): Promise<void> {
  await db.insert(price).values({
    token: row.token,
    timestamp: row.timestamp,
    price: String(row.price),
    source: row.source,
  }).onConflictDoNothing()
}

/**
 * Fetch current prices from DeFiLlama and upsert as `latest` rows.
 * Used by the fetch-prices cron.
 */
export async function refreshLatestPrices(symbols?: string[]): Promise<{ symbol: string; price: number }[]> {
  const tokens = symbols ?? (await db.select({ symbol: tokenTable.symbol }).from(tokenTable)).map((t) => t.symbol)
  const apiPrices = await getCurrentPrices(tokens)
  const now = new Date()
  const written: { symbol: string; price: number }[] = []
  for (const symbol of tokens) {
    const p = apiPrices[symbol]
    if (p == null) continue
    await upsertPrice({ token: symbol, timestamp: now, price: p, source: 'latest' })
    written.push({ symbol, price: p })
  }
  return written
}
