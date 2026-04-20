import { computeFIFO } from '@/lib/fifo'
import { readDataFileStrict } from '@/lib/github'
import { getTreasuryTransactions } from '@/lib/treasury-transactions'
import type { GainLossResponse } from '@/lib/types'

export async function getTreasuryGainLoss(entity: string): Promise<GainLossResponse> {
  const [{ transactions }, priceCacheResult] = await Promise.all([
    getTreasuryTransactions({ entity, limit: null, offset: 0, hydratePrices: true }),
    readDataFileStrict<Record<string, unknown>>('prices.json'),
  ])

  if (!priceCacheResult.ok) {
    throw new Error(priceCacheResult.error)
  }

  const priceCache = priceCacheResult.found ? priceCacheResult.data : {}

  const prices: Record<string, number> = {}
  for (const token of ['SOL', 'ORCA', 'USDC', 'USDT']) {
    const p = priceCache[`${token}::latest`]
    if (typeof p === 'number') prices[token] = p
  }

  const { gainLoss } = computeFIFO(transactions, prices)

  return {
    gainLoss,
    summary: {
      totalGain: gainLoss.reduce((s, g) => s + g.gain, 0),
      shortTermGain: gainLoss.filter(g => g.term === 'ST').reduce((s, g) => s + g.gain, 0),
      longTermGain: gainLoss.filter(g => g.term === 'LT').reduce((s, g) => s + g.gain, 0),
      dispositions: gainLoss.length,
    },
  }
}
