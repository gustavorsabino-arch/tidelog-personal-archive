import { computeFIFOWithTrace } from '@/lib/fifo'
import { toDbEntity } from '@/lib/entity'
import type { Transaction, LotTraceEntry } from '@/lib/types'

export type GainRow = {
  txHash: string
  walletAddress: string
  direction: 'in' | 'out'
  entityId: string
  asset: string
  stGain: number
  ltGain: number
  realizedTerm: 'ST' | 'LT' | 'mixed' | null
  internal: boolean
  internalPairedWalletAddr: string | null
  noBasis: boolean
  lots: LotTraceEntry[]
  balanceAfter: number
}

/**
 * Pure FIFO-output mapping for a single entity+asset. Takes a list of
 * Transactions for one entity (genesis already marked synthetic by the caller),
 * runs the FIFO engine, and emits one GainRow per matching-asset tx.
 *
 * Empty price map skips the unrealized-side compute we don't materialize.
 */
export function computeGainsForEntity(
  txs: Transaction[],
  asset: string,
): { rows: GainRow[]; openLots: ReturnType<typeof computeFIFOWithTrace>['openLots'] } {
  const { trace, openLots } = computeFIFOWithTrace(txs, {})
  const rows: GainRow[] = []
  for (const t of txs) {
    if (t.asset !== asset) continue
    const key = `${t.txHash}::${t.walletAddr}::${t.dir}`
    // Default empty trace when the engine didn't produce one — keeps every
    // materialized tx joinable on the read path with no gaps.
    const entry = trace.get(key) ?? {
      lots: [], balanceAfter: 0, internal: false, internalPairedWalletAddr: null, noBasis: false,
    }
    const lots = entry.lots
    const stGain = lots.filter(l => l.term === 'ST').reduce((s, l) => s + l.gain, 0)
    const ltGain = lots.filter(l => l.term === 'LT').reduce((s, l) => s + l.gain, 0)
    const terms = new Set(lots.map(l => l.term))
    const realizedTerm: 'ST' | 'LT' | 'mixed' | null =
      t.dir !== 'Out' || lots.length === 0
        ? null
        : terms.size > 1 ? 'mixed' : (terms.has('LT') ? 'LT' : 'ST')
    rows.push({
      txHash: t.txHash,
      walletAddress: t.walletAddr,
      direction: t.dir === 'In' ? 'in' : 'out',
      entityId: toDbEntity(t.entity),
      asset,
      stGain, ltGain, realizedTerm,
      internal: entry.internal,
      internalPairedWalletAddr: entry.internalPairedWalletAddr,
      noBasis: entry.noBasis,
      lots,
      balanceAfter: entry.balanceAfter,
    })
  }
  return { rows, openLots }
}
