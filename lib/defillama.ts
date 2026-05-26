/**
 * DeFiLlama price API client.
 * Server-side only (used by cron jobs and API routes).
 */

export const COIN_IDS: Record<string, string> = {
  SOL: 'coingecko:solana',
  ORCA: 'solana:orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  USDC: 'coingecko:usd-coin',
  USDT: 'coingecko:tether',
  PYUSD: 'coingecko:paypal-usd',
  USDG: 'coingecko:global-dollar',
}

export async function getCurrentPrices(tokens = ['SOL', 'ORCA', 'USDC', 'USDT']): Promise<Record<string, number>> {
  const coins = tokens.map(t => COIN_IDS[t]).filter(Boolean).join(',')
  const r = await fetch(`https://coins.llama.fi/prices/current/${coins}`, {
    next: { revalidate: 300 },
  })
  if (!r.ok) throw new Error(`DeFiLlama: ${r.status}`)
  const data = await r.json()
  const prices: Record<string, number> = {}
  for (const token of tokens) {
    const d = data.coins?.[COIN_IDS[token]]
    if (d?.price) prices[token] = d.price
  }
  return prices
}

export async function getHistoricalPrice(token: string, timestamp: number): Promise<number | null> {
  const coinId = COIN_IDS[token]
  if (!coinId) return null
  const r = await fetch(`https://coins.llama.fi/prices/historical/${timestamp}/${coinId}`, {
    next: { revalidate: 3600 },
  })
  if (!r.ok) return null
  const data = await r.json()
  return data.coins?.[coinId]?.price || null
}

export async function getDailyPrices(token: string, startTs: number, days = 365): Promise<Array<{ timestamp: number; price: number }>> {
  const coinId = COIN_IDS[token]
  if (!coinId) return []
  const span = days * 24 * 60 // minutes
  const r = await fetch(`https://coins.llama.fi/chart/${coinId}?start=${startTs}&span=${span}&period=1d`, {
    next: { revalidate: 3600 },
  })
  if (!r.ok) return []
  const data = await r.json()
  return data.coins?.[coinId]?.prices || []
}
