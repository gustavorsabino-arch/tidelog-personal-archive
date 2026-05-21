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
  it('formats a priced tx as "Dir Asset Qty @ Price = USD (txHashShort…)"', () => {
    const t = mkTx({ dir: 'In', asset: 'ORCA', qty: 10.5, price: 2, usd: 21, txHash: 'AbCdEf012345' })
    const got = defaultDescription(t)
    expect(got).toBe('In ORCA 10.50 @ $2.00 = $21.00 (AbCdEf01…)')
  })

  it('handles null price gracefully', () => {
    const t = mkTx({ dir: 'Out', asset: 'SOL', qty: 1.234, price: null, usd: null })
    const got = defaultDescription(t)
    expect(got).toContain('Out SOL')
    expect(got).toContain('no price')
  })

  it('handles null usd while price is present', () => {
    // Edge case: stables with null usd — treat (price != null && usd == null) the same as (price == null)
    const t = mkTx({ dir: 'In', asset: 'USDC', qty: 100, price: 1, usd: null })
    const got = defaultDescription(t)
    expect(got).toContain('USDC')
    expect(got).toContain('no price')
  })

  it('truncates txHash to 8 chars + ellipsis', () => {
    const t = mkTx({ txHash: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' })
    const got = defaultDescription(t)
    expect(got).toMatch(/\(ABCDEFGH…\)$/)
  })

  it('formats SOL quantities with 4 decimal places', () => {
    const t = mkTx({ dir: 'Out', asset: 'SOL', qty: 1.234, price: null, usd: null })
    const got = defaultDescription(t)
    expect(got).toBe('Out SOL 1.2340 (no price)')
  })

  it('uses thousands separator for large USD amounts', () => {
    const t = mkTx({ dir: 'In', asset: 'ORCA', qty: 1000, price: 1.5, usd: 1500.5, txHash: 'XX123456abcdef' })
    const got = defaultDescription(t)
    expect(got).toBe('In ORCA 1,000.00 @ $1.50 = $1,500.50 (XX123456…)')
  })
})
