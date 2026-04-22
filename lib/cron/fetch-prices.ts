import { refreshLatestPrices } from '@/lib/prices'

/**
 * Cron: refresh latest prices for every tracked token.
 * Upserts `latest` rows into the `price` table.
 */
export async function fetchPricesJob() {
  const written = await refreshLatestPrices()
  return {
    ok: true,
    tokens: written.length,
    prices: Object.fromEntries(written.map((w) => [w.symbol, w.price])),
  }
}
