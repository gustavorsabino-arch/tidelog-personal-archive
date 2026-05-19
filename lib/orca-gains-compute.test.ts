import { describe, it, expect } from 'bun:test'
import { computeGainsForEntity } from './orca-gains-compute'
import type { Transaction } from './types'

function mkTx(over: Partial<Transaction>): Transaction {
  const blockTime = over.blockTime ?? 0
  return {
    txHash: 'h', walletAddr: 'W', wallet: 'W', entity: 'Opco',
    blockTime,
    // FIFO uses tx.date for holding-period math (lib/fifo.ts:270), not blockTime.
    // Default date to a value derived from blockTime so tests can vary just blockTime.
    date: new Date(blockTime * 1000).toISOString(),
    asset: 'ORCA', qty: 1, dir: 'In',
    price: 1, usd: 1, priceSource: 'cron',
    counterparty: null, category: null,
    ...over,
  }
}

describe('computeGainsForEntity', () => {
  it('produces ST gain for disposal within 365 days', () => {
    const acq = mkTx({ txHash: 'a', dir: 'In',  blockTime: 1_700_000_000, price: 1, usd: 10, qty: 10 })
    const sell = mkTx({ txHash: 'b', dir: 'Out', blockTime: 1_700_000_000 + 30 * 86400, price: 2, usd: 20, qty: 10 })
    const { rows, openLots } = computeGainsForEntity([acq, sell], 'ORCA')
    const sellRow = rows.find(r => r.txHash === 'b')!
    expect(sellRow.stGain).toBe(10)
    expect(sellRow.ltGain).toBe(0)
    expect(sellRow.realizedTerm).toBe('ST')
    expect(openLots).toEqual([])
  })

  it('produces LT gain for disposal after 365 days', () => {
    const acq = mkTx({ txHash: 'a', dir: 'In',  blockTime: 1_700_000_000, price: 1, usd: 10, qty: 10 })
    const sell = mkTx({ txHash: 'b', dir: 'Out', blockTime: 1_700_000_000 + 400 * 86400, price: 2, usd: 20, qty: 10 })
    const { rows } = computeGainsForEntity([acq, sell], 'ORCA')
    const sellRow = rows.find(r => r.txHash === 'b')!
    expect(sellRow.stGain).toBe(0)
    expect(sellRow.ltGain).toBe(10)
    expect(sellRow.realizedTerm).toBe('LT')
  })

  it('writes a gain row for every ORCA tx (including acquisitions with no realized gain)', () => {
    const acq1 = mkTx({ txHash: 'a', dir: 'In', blockTime: 1_700_000_000, price: 1, usd: 10, qty: 10 })
    const acq2 = mkTx({ txHash: 'b', dir: 'In', blockTime: 1_700_000_100, price: 2, usd: 20, qty: 10 })
    const { rows } = computeGainsForEntity([acq1, acq2], 'ORCA')
    expect(rows.map(r => r.txHash).sort()).toEqual(['a', 'b'])
    expect(rows.every(r => r.stGain === 0 && r.ltGain === 0)).toBe(true)
  })
})

// Internal-transfer detection is verified by integration smoke (Task 19) against
// real ORCA data — the FIFO engine's internal-pair inference depends on richer
// fixture shapes than is ergonomic to set up here.
