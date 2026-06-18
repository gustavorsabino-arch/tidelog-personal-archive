export type RepriceRow = {
  id: string
  asset: string
  blockTime: number
  qty: number
  price: string | null
  usd: string | null
  priceSource: string | null
}

export type LookupResult = { price: number; source: string } | null

export type RepriceAction =
  | {
      kind: 'reprice'
      price: number
      usd: number
      source: string
      backup: { oldPrice: string | null; oldUsd: string | null; oldPriceSource: string | null }
    }
  | { kind: 'fail'; error: string }

/**
 * Decide what to do with one `'cache'` row given its point-in-time lookup.
 * ALWAYS re-prices when a positive price is found — C1 deliberately overwrites
 * the existing day-level price (unlike hydrateTransactionPrices, which skips
 * already-priced rows). Originals are captured for rollback.
 */
export function planReprice(row: RepriceRow, lookup: LookupResult): RepriceAction {
  if (lookup && Number.isFinite(lookup.price) && lookup.price > 0) {
    return {
      kind: 'reprice',
      price: lookup.price,
      usd: Math.abs(row.qty) * lookup.price,
      source: lookup.source,
      backup: { oldPrice: row.price, oldUsd: row.usd, oldPriceSource: row.priceSource },
    }
  }
  return { kind: 'fail', error: 'no price from birdeye/defillama' }
}
