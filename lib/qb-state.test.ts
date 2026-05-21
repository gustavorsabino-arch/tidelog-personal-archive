import { describe, it, expect } from 'bun:test'
import { defaultDescription } from './qb-state'
import type { Transaction } from './types'

function mkTx(over: Partial<Transaction> = {}): Transaction {
  return {
    txHash: 'AbC123def456GhI789jkl', walletAddr: 'W', wallet: 'Opco Treasury',
    entity: 'Opco', blockTime: 1_700_000_000, date: new Date(1_700_000_000_000).toISOString(),
    asset: 'ORCA', qty: 10.5, dir: 'In',
    price: 2, usd: 21, priceSource: 'cron',
    counterparty: null, category: null,
    ...over,
  }
}

describe('defaultDescription', () => {
  it('formats a priced tx as "Dir - Asset - Qty - $Amount - hash"', () => {
    const t = mkTx({ dir: 'In', asset: 'ORCA', qty: 10.5, price: 2, usd: 21, txHash: 'AbCdEf012345' })
    expect(defaultDescription(t)).toBe('In - ORCA - 10.50 - $21.00 - AbCdEf012345')
  })

  it('handles null usd as "(no price)"', () => {
    const t = mkTx({ dir: 'Out', asset: 'SOL', qty: 1.234, price: null, usd: null, txHash: 'h' })
    expect(defaultDescription(t)).toBe('Out - SOL - 1.2340 - (no price) - h')
  })

  it('treats null usd the same regardless of price (stables edge case)', () => {
    // (price != null && usd == null) — falls into the same (no price) branch.
    const t = mkTx({ dir: 'In', asset: 'USDC', qty: 100, price: 1, usd: null, txHash: 'h' })
    expect(defaultDescription(t)).toBe('In - USDC - 100.00 - (no price) - h')
  })

  it('keeps the full tx hash (not truncated)', () => {
    const longHash = '62BVzBMmaUFLmwVshvK2EVwUrUVYNxLWKjEcJPnrkpF34Wy7TMuTukVDSeEx5aUu5KehD1YTnYSLfuyqtvAYzktu'
    const t = mkTx({ txHash: longHash, dir: 'In', asset: 'USDC', qty: 38.61, price: 1, usd: 38.61 })
    expect(defaultDescription(t)).toBe(`In - USDC - 38.61 - $38.61 - ${longHash}`)
  })

  it('formats SOL quantities with 4 decimal places', () => {
    const t = mkTx({ dir: 'Out', asset: 'SOL', qty: 1.234, price: 200, usd: 246.8, txHash: 'h' })
    expect(defaultDescription(t)).toBe('Out - SOL - 1.2340 - $246.80 - h')
  })

  it('uses thousands separator for large USD amounts', () => {
    const t = mkTx({ dir: 'In', asset: 'ORCA', qty: 1000, price: 1.5, usd: 1500.5, txHash: 'XX123456abcdef' })
    expect(defaultDescription(t)).toBe('In - ORCA - 1,000.00 - $1,500.50 - XX123456abcdef')
  })
})
