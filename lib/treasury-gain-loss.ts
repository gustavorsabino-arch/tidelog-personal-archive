import { computeFIFO } from '@/lib/fifo'
import { getCurrentPrices } from '@/lib/defillama'
import { getTreasuryTransactionsAsc } from '@/lib/treasury-transactions'
import type { GainLossEntry, GainLossResponse, Transaction } from '@/lib/types'

const GAIN_LOSS_TOKENS = ['SOL', 'ORCA', 'USDC', 'USDT'] as const

// Genesis txs (priceSource='genesis') are the original TGE allocation. They
// must enter FIFO as cost-basis lots so subsequent disposals match against
// the TGE price. Mirror the marking the unrealized + ORCA-ledger flows do.
function markSynthetic(txs: Transaction[]): Transaction[] {
  return txs.map((t) =>
    t.priceSource === 'genesis' ? ({ ...t, _synthetic: true } as Transaction) : t,
  )
}

async function computeAllGainLoss(entity: string): Promise<GainLossEntry[]> {
  const [transactions, currentPrices] = await Promise.all([
    getTreasuryTransactionsAsc(entity),
    getCurrentPrices(),
  ])

  const prices: Record<string, number> = {}
  for (const token of GAIN_LOSS_TOKENS) {
    const p = currentPrices[token]
    if (typeof p === 'number') prices[token] = p
  }

  // FIFO must run over the full transaction history (including genesis lots);
  // narrowing the input would corrupt lot matching. Date filtering happens on
  // the output below.
  const { gainLoss } = computeFIFO(markSynthetic(transactions), prices)
  return gainLoss
}

export async function getTreasuryGainLoss(
  entity: string,
  opts?: { from?: number | null; to?: number | null },
): Promise<GainLossResponse> {
  const all = await computeAllGainLoss(entity)

  const fromMs = opts?.from != null ? opts.from * 1000 : null
  const toMs = opts?.to != null ? opts.to * 1000 : null

  const gainLoss = fromMs == null && toMs == null
    ? all
    : all.filter((g) => {
        const t = new Date(g.soldDate).getTime()
        if (fromMs != null && t < fromMs) return false
        if (toMs != null && t > toMs) return false
        return true
      })

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

export async function getGainLossMonths(entity: string): Promise<string[]> {
  const all = await computeAllGainLoss(entity)
  const set = new Set<string>()
  for (const g of all) {
    const d = new Date(g.soldDate)
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    set.add(`${y}-${m}`)
  }
  return Array.from(set).sort().reverse()
}
