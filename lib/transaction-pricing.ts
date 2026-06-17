import { getHistoricalPrice } from '@/lib/prices'
import { STABLE_TOKENS } from '@/lib/constants'
import type { Transaction } from '@/lib/types'

// Per-run cache, keyed by `${asset}::${blockTimeSec}` → resolved price entry, or
// null for a recorded miss (so the same instant isn't re-queried). Shared across
// wallets within a cron run.
type CacheEntry = { price: number; source: string } | null
type PriceCache = Record<string, unknown>

type HydrateTransactionPricesOptions = {
  priceCache: PriceCache
  fetchMissingHistory?: boolean
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Price each transaction at its EXACT block second via the price wrapper
 * (Birdeye point-in-time → DeFiLlama fallback), persisting the real source.
 * Already-priced rows are left untouched (re-pricing is a later phase).
 * Stablecoins short-circuit to $1.
 */
export async function hydrateTransactionPrices(
  transactions: Transaction[],
  { priceCache, fetchMissingHistory = true }: HydrateTransactionPricesOptions,
): Promise<{ transactions: Transaction[]; cacheDirty: boolean }> {
  const hydrated = transactions.map((tx) => ({ ...tx }))
  let cacheDirty = false

  for (const tx of hydrated) {
    if (STABLE_TOKENS.has(tx.asset)) {
      if (!isPositiveNumber(tx.price)) tx.price = 1
      if (tx.usd == null) tx.usd = Math.abs(tx.qty)
      if (!tx.priceSource) tx.priceSource = 'stable'
      continue
    }

    if (isPositiveNumber(tx.price) && tx.usd != null) continue
    if (!fetchMissingHistory) continue

    const key = `${tx.asset}::${tx.blockTime}`
    if (!(key in priceCache)) {
      const res = await getHistoricalPrice(tx.asset, tx.blockTime)
      const entry: CacheEntry =
        res && isPositiveNumber(res.price) ? { price: res.price, source: res.source } : null
      priceCache[key] = entry
      cacheDirty = true
    }
    const entry = priceCache[key] as CacheEntry

    if (entry) {
      if (!isPositiveNumber(tx.price)) {
        tx.price = entry.price
        tx.priceSource = tx.priceSource || entry.source
      }
      if (tx.usd == null && isPositiveNumber(tx.price)) {
        tx.usd = Math.abs(tx.qty) * tx.price
      }
    }
  }

  return { transactions: hydrated, cacheDirty }
}
