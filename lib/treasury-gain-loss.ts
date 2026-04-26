import { computeFIFO } from '@/lib/fifo'
import { getCurrentPrices } from '@/lib/defillama'
import { getTreasuryTransactions } from '@/lib/treasury-transactions'
import type { GainLossResponse } from '@/lib/types'

const GAIN_LOSS_TOKENS = ['SOL', 'ORCA', 'USDC', 'USDT'] as const

export async function getTreasuryGainLoss(entity: string): Promise<GainLossResponse> {
  const [{ transactions }, currentPrices] = await Promise.all([
    getTreasuryTransactions({ entity, limit: null, offset: 0 }),
    getCurrentPrices(),
  ])

  const prices: Record<string, number> = {}
  for (const token of GAIN_LOSS_TOKENS) {
    const p = currentPrices[token]
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
