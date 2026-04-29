import { test, expect } from 'bun:test'
import { computeFIFO } from './fifo'
import type { Transaction } from './types'

function tx(over: Partial<Transaction>): Transaction {
  return {
    txHash: 'tx',
    walletAddr: 'wA',
    wallet: 'walletA',
    entity: 'opco',
    blockTime: 0,
    date: '2024-01-01T00:00:00Z',
    asset: 'ORCA',
    qty: 0,
    dir: 'In',
    price: null,
    usd: null,
    priceSource: null,
    counterparty: null,
    category: null,
    ...over,
  }
}

test('snapshot: simple buy then sell produces one ST disposition', () => {
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: 1700000000, date: '2023-11-14T22:13:20Z', qty: 100, dir: 'In', price: 1, usd: 100 }),
    tx({ txHash: 't2', blockTime: 1700100000, date: '2023-11-16T01:00:00Z', qty: 40, dir: 'Out', price: 2, usd: 80 }),
  ]
  const { gainLoss, unrealized } = computeFIFO(txs, { ORCA: 3 })
  expect(gainLoss).toHaveLength(1)
  expect(gainLoss[0]).toMatchObject({ qty: 40, buyPrice: 1, sellPrice: 2, gain: 40, term: 'ST', txHash: 't2' })
  expect(unrealized).toHaveLength(1)
  expect(unrealized[0]).toMatchObject({ qty: 60, costBasis: 60, currentPrice: 3, unrealGain: 120 })
})

test('snapshot: stable tokens are skipped', () => {
  const txs: Transaction[] = [
    tx({ asset: 'USDC', qty: 100, dir: 'In', price: 1, usd: 100 }),
    tx({ asset: 'USDC', qty: 50, dir: 'Out', price: 1, usd: 50 }),
  ]
  const { gainLoss, unrealized } = computeFIFO(txs, { USDC: 1 })
  expect(gainLoss).toEqual([])
  expect(unrealized).toEqual([])
})
