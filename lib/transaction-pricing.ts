import { getCurrentPrices, getDailyPrices, getHistoricalPrice } from '@/lib/defillama'
import { STABLE_TOKENS } from '@/lib/constants'
import type { Transaction } from '@/lib/types'

type PriceCache = Record<string, unknown>

type HydrateTransactionPricesOptions = {
  priceCache: PriceCache
  fetchMissingHistory?: boolean
}

const HOUR = 3600
const DAY = 86400

function getHourTs(blockTime: number) {
  return Math.floor(blockTime / HOUR) * HOUR
}

function getDayTs(blockTime: number) {
  return Math.floor(blockTime / DAY) * DAY
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export async function primeLatestPrices(priceCache: PriceCache): Promise<void> {
  const current = await getCurrentPrices()
  for (const [token, p] of Object.entries(current)) {
    priceCache[`${token}::latest`] = p
  }
}

function getCachedTransactionPrice(priceCache: PriceCache, token: string, blockTime: number): number | null {
  if (STABLE_TOKENS.has(token)) return 1

  const hourTs = getHourTs(blockTime)
  const dayTs = getDayTs(blockTime)

  const candidates = [
    priceCache[`${token}::${hourTs}`],
    priceCache[`${token}::${dayTs}`],
    priceCache[`${token}::${dayTs - DAY}`],
    priceCache[`${token}::${dayTs + DAY}`],
    priceCache[`${token}::${dayTs - DAY * 2}`],
    priceCache[`${token}::${dayTs + DAY * 2}`],
  ]

  for (const candidate of candidates) {
    if (isPositiveNumber(candidate)) return candidate
  }

  const latest = priceCache[`${token}::latest`]
  if (isPositiveNumber(latest) && blockTime >= Math.floor(Date.now() / 1000) - DAY * 3) {
    return latest
  }

  return null
}

async function warmDailyPrices(priceCache: PriceCache, token: string, missingDayTs: number[]): Promise<boolean> {
  if (!missingDayTs.length || STABLE_TOKENS.has(token)) return false

  let cacheDirty = false
  const earliestDayTs = Math.min(...missingDayTs)
  const latestDayTs = Math.max(...missingDayTs)
  const days = Math.max(1, Math.ceil((latestDayTs - earliestDayTs) / DAY) + 1)

  const dailyPrices = await getDailyPrices(token, earliestDayTs, days)
  for (const point of dailyPrices) {
    if (!isPositiveNumber(point.price)) continue
    const dayTs = getDayTs(point.timestamp)
    priceCache[`${token}::${dayTs}`] = point.price
    for (let hour = 0; hour < 24; hour++) {
      priceCache[`${token}::${dayTs + hour * HOUR}`] = point.price
    }
    cacheDirty = true
  }

  const stillMissing = missingDayTs.filter(dayTs => !isPositiveNumber(priceCache[`${token}::${dayTs}`]))
  for (const dayTs of stillMissing) {
    const fallback = await getHistoricalPrice(token, dayTs + 12 * HOUR)
    if (!isPositiveNumber(fallback)) continue
    priceCache[`${token}::${dayTs}`] = fallback
    for (let hour = 0; hour < 24; hour++) {
      priceCache[`${token}::${dayTs + hour * HOUR}`] = fallback
    }
    cacheDirty = true
  }

  return cacheDirty
}

export async function hydrateTransactionPrices(
  transactions: Transaction[],
  { priceCache, fetchMissingHistory = true }: HydrateTransactionPricesOptions
): Promise<{ transactions: Transaction[]; cacheDirty: boolean }> {
  const hydrated = transactions.map(tx => ({ ...tx }))
  let cacheDirty = false

  if (fetchMissingHistory) {
    const missingDaysByToken = new Map<string, Set<number>>()
    for (const tx of hydrated) {
      if (STABLE_TOKENS.has(tx.asset)) continue
      if (isPositiveNumber(tx.price) && tx.usd != null) continue
      if (getCachedTransactionPrice(priceCache, tx.asset, tx.blockTime)) continue

      if (!missingDaysByToken.has(tx.asset)) missingDaysByToken.set(tx.asset, new Set<number>())
      missingDaysByToken.get(tx.asset)!.add(getDayTs(tx.blockTime))
    }

    for (const [token, days] of missingDaysByToken) {
      const warmed = await warmDailyPrices(priceCache, token, [...days].sort((a, b) => a - b))
      cacheDirty = cacheDirty || warmed
    }
  }

  for (const tx of hydrated) {
    if (STABLE_TOKENS.has(tx.asset)) {
      if (!isPositiveNumber(tx.price)) tx.price = 1
      if (tx.usd == null) tx.usd = Math.abs(tx.qty)
      if (!tx.priceSource) tx.priceSource = 'stable'
      continue
    }

    const cachedPrice = getCachedTransactionPrice(priceCache, tx.asset, tx.blockTime)
    if (!isPositiveNumber(tx.price) && isPositiveNumber(cachedPrice)) {
      tx.price = cachedPrice
      tx.priceSource = tx.priceSource || 'cache'
    }
    if (tx.usd == null && isPositiveNumber(tx.price)) {
      tx.usd = Math.abs(tx.qty) * tx.price
    }
  }

  return { transactions: hydrated, cacheDirty }
}
