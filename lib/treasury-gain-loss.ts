import { computeFIFO } from '@/lib/fifo'
import { getLatestPrice } from '@/lib/prices'
import { getTreasuryTransactions } from '@/lib/treasury-transactions'
import type { GainLossResponse } from '@/lib/types'

const GAIN_LOSS_TOKENS = ['SOL', 'ORCA', 'USDC', 'USDT'] as const

export async function getTreasuryGainLoss(entity: string): Promise<GainLossResponse> {
  const { transactions } = await getTreasuryTransactions({
    entity,
    limit: null,
    offset: 0,
    hydratePrices: true,
  })

  const priceEntries = await Promise.all(
    GAIN_LOSS_TOKENS.map(async (token) => [token, await getLatestPrice(token)] as const),
  )
  const prices: Record<string, number> = {}
  for (const [token, p] of priceEntries) {
    if (typeof p === 'number') prices[token] = p
  }

  const { gainLoss } = computeFIFO(transactions, prices)

  return {
    gainLoss,
    summary: {
      totalGain: gainLoss.reduce((s, g) => s + g.gain, 0),
      shortTermGain: gainLoss.filter((g) => g.term === 'ST').reduce((s, g) => s + g.gain, 0),
      longTermGain: gainLoss.filter((g) => g.term === 'LT').reduce((s, g) => s + g.gain, 0),
      dispositions: gainLoss.length,
    },
  }
}
