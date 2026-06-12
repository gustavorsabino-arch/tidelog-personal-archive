/**
 * Birdeye price API client.
 * Server-side only (uses BIRDEYE_API_KEY). Mirrors lib/defillama.ts's function
 * shapes so lib/prices.ts can call either provider uniformly.
 *
 * Birdeye is keyed by SPL mint address; we map symbol → mint via PRICE_MINTS.
 * Symbols with no mint (e.g. ETH/BTC) are skipped so the wrapper can fall back
 * to DeFiLlama for them.
 */
import { PRICE_MINTS } from '@/lib/constants'

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || ''
const BASE = 'https://public-api.birdeye.so'

/** True when an API key is configured; lib/prices.ts gates Birdeye on this. */
export const hasBirdeyeKey = BIRDEYE_API_KEY.length > 0

function headers() {
  return {
    'X-API-KEY': BIRDEYE_API_KEY,
    'x-chain': 'solana',
    accept: 'application/json',
  }
}

// mint → symbol, derived from the symbol → mint PRICE_MINTS map.
const SYMBOL_BY_MINT: Record<string, string> = Object.fromEntries(
  Object.entries(PRICE_MINTS).map(([sym, mint]) => [mint, sym]),
)

export async function getCurrentPrices(
  tokens = ['SOL', 'ORCA', 'USDC', 'USDT'],
): Promise<Record<string, number>> {
  const mints = tokens.map((t) => PRICE_MINTS[t]).filter(Boolean)
  if (mints.length === 0) return {}
  const r = await fetch(`${BASE}/defi/multi_price?list_address=${mints.join(',')}`, {
    headers: headers(),
    next: { revalidate: 300 },
  })
  if (!r.ok) throw new Error(`Birdeye multi_price: ${r.status}`)
  const data = await r.json()
  if (!data?.success) throw new Error('Birdeye multi_price: success=false')
  const prices: Record<string, number> = {}
  for (const [mint, entry] of Object.entries(data.data ?? {})) {
    const sym = SYMBOL_BY_MINT[mint]
    const value = (entry as { value?: number } | null)?.value
    if (sym && typeof value === 'number' && value > 0) prices[sym] = value
  }
  return prices
}

export async function getHistoricalPrice(token: string, timestamp: number): Promise<number | null> {
  const mint = PRICE_MINTS[token]
  if (!mint) return null
  const r = await fetch(
    `${BASE}/defi/historical_price_unix?address=${mint}&unixtime=${timestamp}`,
    { headers: headers(), next: { revalidate: 3600 } },
  )
  if (!r.ok) return null
  const data = await r.json()
  const value = data?.data?.value
  return typeof value === 'number' && value > 0 ? value : null
}

export async function getDailyPrices(
  token: string,
  startTs: number,
  days = 365,
): Promise<Array<{ timestamp: number; price: number }>> {
  const mint = PRICE_MINTS[token]
  if (!mint) return []
  // `days` = number of daily points to return, mirroring lib/defillama.ts.
  // Birdeye's time_to is inclusive, so N points spans (N-1) day-steps.
  const span = Math.min(Math.max(1, days), 1000)
  const timeTo = startTs + (span - 1) * 86400
  const r = await fetch(
    `${BASE}/defi/history_price?address=${mint}&address_type=token&type=1D&time_from=${startTs}&time_to=${timeTo}`,
    { headers: headers(), next: { revalidate: 3600 } },
  )
  if (!r.ok) return []
  const data = await r.json()
  const items: Array<{ unixTime?: number; value?: number }> = data?.data?.items ?? []
  return items
    .filter((it) => typeof it.unixTime === 'number' && typeof it.value === 'number' && it.value > 0)
    .map((it) => ({ timestamp: it.unixTime as number, price: it.value as number }))
}
