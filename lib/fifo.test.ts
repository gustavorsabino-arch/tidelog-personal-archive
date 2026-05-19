import { test, expect } from 'bun:test'
import { computeFIFO, computeFIFOWithTrace } from './fifo'
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

const KEY = (txHash: string, wallet: string, dir: 'In' | 'Out') => `${txHash}::${wallet}::${dir}`

test('trace: simple In creates one lot entry', () => {
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: 1700000000, date: '2023-11-14T22:13:20Z', qty: 100, dir: 'In', price: 1, usd: 100 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 1 })
  const entry = trace.get(KEY('t1', 'wA', 'In'))
  expect(entry).toBeDefined()
  expect(entry!.lots).toHaveLength(1)
  expect(entry!.lots[0]).toMatchObject({ qty: 100, costPerUnit: 1, acqTxHash: 't1', term: 'ST', gain: 0 })
  expect(entry!.balanceAfter).toBe(100)
  expect(entry!.internal).toBe(false)
  expect(entry!.noBasis).toBe(false)
})

test('trace: external Out FIFO consumes oldest first', () => {
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: 1700000000, date: '2023-11-14T22:13:20Z', qty: 100, dir: 'In', price: 1 }),
    tx({ txHash: 't2', blockTime: 1700100000, date: '2023-11-16T01:00:00Z', qty: 100, dir: 'In', price: 2 }),
    tx({ txHash: 't3', blockTime: 1700200000, date: '2023-11-17T03:46:40Z', qty: 50, dir: 'Out', price: 3 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 3 })
  const out = trace.get(KEY('t3', 'wA', 'Out'))!
  expect(out.lots).toHaveLength(1)
  expect(out.lots[0]).toMatchObject({ qty: 50, costPerUnit: 1, acqTxHash: 't1', gain: 100 })
  expect(out.balanceAfter).toBe(150)
})

test('trace: external Out spans multiple lots', () => {
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: 1700000000, date: '2023-11-14T22:13:20Z', qty: 100, dir: 'In', price: 1 }),
    tx({ txHash: 't2', blockTime: 1700100000, date: '2023-11-16T01:00:00Z', qty: 50, dir: 'In', price: 2 }),
    tx({ txHash: 't3', blockTime: 1700200000, date: '2023-11-17T03:46:40Z', qty: 130, dir: 'Out', price: 3 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 3 })
  const out = trace.get(KEY('t3', 'wA', 'Out'))!
  expect(out.lots).toHaveLength(2)
  expect(out.lots[0]).toMatchObject({ qty: 100, costPerUnit: 1, acqTxHash: 't1' })
  expect(out.lots[1]).toMatchObject({ qty: 30, costPerUnit: 2, acqTxHash: 't2' })
  expect(out.lots[0].gain + out.lots[1].gain).toBeCloseTo(130 * 3 - (100 * 1 + 30 * 2), 6)
})

test('trace: balanceAfter accurate across In/Out sequence', () => {
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: 1, date: '2024-01-01T00:00:00Z', qty: 100, dir: 'In', price: 1 }),
    tx({ txHash: 't2', blockTime: 2, date: '2024-01-02T00:00:00Z', qty: 50, dir: 'In', price: 2 }),
    tx({ txHash: 't3', blockTime: 3, date: '2024-01-03T00:00:00Z', qty: 30, dir: 'Out', price: 3 }),
    tx({ txHash: 't4', blockTime: 4, date: '2024-01-04T00:00:00Z', qty: 70, dir: 'In', price: 4 }),
    tx({ txHash: 't5', blockTime: 5, date: '2024-01-05T00:00:00Z', qty: 100, dir: 'Out', price: 5 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 5 })
  expect(trace.get(KEY('t1', 'wA', 'In'))!.balanceAfter).toBe(100)
  expect(trace.get(KEY('t2', 'wA', 'In'))!.balanceAfter).toBe(150)
  expect(trace.get(KEY('t3', 'wA', 'Out'))!.balanceAfter).toBe(120)
  expect(trace.get(KEY('t4', 'wA', 'In'))!.balanceAfter).toBe(190)
  expect(trace.get(KEY('t5', 'wA', 'Out'))!.balanceAfter).toBe(90)
})

test('trace: internal transfer preserves cost basis', () => {
  const txs: Transaction[] = [
    tx({ walletAddr: 'wA', wallet: 'A', txHash: 't1', blockTime: 1, date: '2024-01-01T00:00:00Z', qty: 100, dir: 'In', price: 2 }),
    tx({ walletAddr: 'wA', wallet: 'A', txHash: 't2', blockTime: 2, date: '2024-01-02T00:00:00Z', qty: 60, dir: 'Out' }),
    tx({ walletAddr: 'wB', wallet: 'B', txHash: 't2', blockTime: 2, date: '2024-01-02T00:00:00Z', qty: 60, dir: 'In' }),
  ]
  const { gainLoss, trace } = computeFIFOWithTrace(txs, { ORCA: 3 })
  expect(gainLoss).toEqual([])
  const inEntry = trace.get(KEY('t2', 'wB', 'In'))!
  expect(inEntry.internal).toBe(true)
  expect(inEntry.internalPairedWalletAddr).toBe('wA')
  expect(inEntry.lots).toHaveLength(1)
  expect(inEntry.lots[0]).toMatchObject({ qty: 60, costPerUnit: 2, acqTxHash: 't1', acqWalletAddr: 'wA' })
  const outEntry = trace.get(KEY('t2', 'wA', 'Out'))!
  expect(outEntry.internal).toBe(true)
  expect(outEntry.lots).toEqual([])
})

test('trace: internal transfer with insufficient sender lots falls back to market price', () => {
  const txs: Transaction[] = [
    tx({ walletAddr: 'wA', wallet: 'A', txHash: 't1', blockTime: 1, date: '2024-01-01T00:00:00Z', qty: 30, dir: 'In', price: 2 }),
    tx({ walletAddr: 'wA', wallet: 'A', txHash: 't2', blockTime: 2, date: '2024-01-02T00:00:00Z', qty: 100, dir: 'Out', price: 5 }),
    tx({ walletAddr: 'wB', wallet: 'B', txHash: 't2', blockTime: 2, date: '2024-01-02T00:00:00Z', qty: 100, dir: 'In', price: 5 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 5 })
  const inEntry = trace.get(KEY('t2', 'wB', 'In'))!
  expect(inEntry.internal).toBe(true)
  expect(inEntry.lots).toHaveLength(2)
  expect(inEntry.lots[0]).toMatchObject({ qty: 30, costPerUnit: 2 })
  expect(inEntry.lots[1]).toMatchObject({ qty: 70, costPerUnit: 5 })
})

test('trace: noBasis flag set when Out has no lots', () => {
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: 1, date: '2024-01-01T00:00:00Z', qty: 50, dir: 'Out', price: 1 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 1 })
  const out = trace.get(KEY('t1', 'wA', 'Out'))!
  expect(out.noBasis).toBe(true)
  expect(out.lots).toEqual([])
})

test('trace: noBasis ignores sub-1e-2 unmatched dust (e.g. closeout-sweep tail)', () => {
  // Wallet receives exactly 100 ORCA, then disposes 100.005 — 0.005 residue is dust.
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: 1, date: '2024-01-01T00:00:00Z', qty: 100, dir: 'In', price: 1 }),
    tx({ txHash: 't2', blockTime: 2, date: '2024-01-02T00:00:00Z', qty: 100.005, dir: 'Out', price: 2 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 2 })
  const out = trace.get(KEY('t2', 'wA', 'Out'))!
  expect(out.noBasis).toBe(false)
  expect(out.lots).toHaveLength(1)
})

test('trace: noBasis still fires for material (>1e-2) unmatched residue', () => {
  // Wallet receives 100, disposes 105 — 5 ORCA is material, must flag.
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: 1, date: '2024-01-01T00:00:00Z', qty: 100, dir: 'In', price: 1 }),
    tx({ txHash: 't2', blockTime: 2, date: '2024-01-02T00:00:00Z', qty: 105, dir: 'Out', price: 2 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 2 })
  const out = trace.get(KEY('t2', 'wA', 'Out'))!
  expect(out.noBasis).toBe(true)
})

test('trace: term boundary ST <365d, LT >365d', () => {
  const day = 86400
  const acqTime = 1700000000
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: acqTime, date: new Date(acqTime * 1000).toISOString(), qty: 100, dir: 'In', price: 1 }),
    tx({ txHash: 't2', blockTime: acqTime + 364 * day, date: new Date((acqTime + 364 * day) * 1000).toISOString(), qty: 30, dir: 'Out', price: 2 }),
    tx({ txHash: 't3', blockTime: acqTime + 366 * day, date: new Date((acqTime + 366 * day) * 1000).toISOString(), qty: 30, dir: 'Out', price: 2 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 2 })
  expect(trace.get(KEY('t2', 'wA', 'Out'))!.lots[0].term).toBe('ST')
  expect(trace.get(KEY('t3', 'wA', 'Out'))!.lots[0].term).toBe('LT')
})

test('trace: mixed-term Out (single disposal spanning ST and LT lots)', () => {
  const day = 86400
  const oldT = 1700000000
  const newT = oldT + 200 * day
  const sellT = oldT + 400 * day
  const txs: Transaction[] = [
    tx({ txHash: 't1', blockTime: oldT, date: new Date(oldT * 1000).toISOString(), qty: 50, dir: 'In', price: 1 }),
    tx({ txHash: 't2', blockTime: newT, date: new Date(newT * 1000).toISOString(), qty: 50, dir: 'In', price: 2 }),
    tx({ txHash: 't3', blockTime: sellT, date: new Date(sellT * 1000).toISOString(), qty: 80, dir: 'Out', price: 3 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 3 })
  const out = trace.get(KEY('t3', 'wA', 'Out'))!
  expect(out.lots).toHaveLength(2)
  expect(out.lots[0].term).toBe('LT') // older lot, >365 days
  expect(out.lots[1].term).toBe('ST') // newer lot, ~200 days
})

test('trace: synthetic genesis-priced In is treated like external In for downstream FIFO', () => {
  const txs: Transaction[] = [
    { ...tx({ txHash: 'genesis', blockTime: 1, date: '2021-08-09T00:00:00Z', qty: 100, dir: 'In', price: 2.5, priceSource: 'genesis' }), _synthetic: true } as any,
    tx({ txHash: 't1', blockTime: 1700000000, date: '2023-11-14T22:13:20Z', qty: 30, dir: 'Out', price: 5 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { ORCA: 5 })
  const out = trace.get(KEY('t1', 'wA', 'Out'))!
  expect(out.lots[0]).toMatchObject({ costPerUnit: 2.5, acqTxHash: 'genesis' })
  expect(out.lots[0].term).toBe('LT')
})

test('trace: stable tokens produce no trace entries', () => {
  const txs: Transaction[] = [
    tx({ asset: 'USDC', txHash: 't1', blockTime: 1, date: '2024-01-01T00:00:00Z', qty: 100, dir: 'In', price: 1 }),
  ]
  const { trace } = computeFIFOWithTrace(txs, { USDC: 1 })
  expect(trace.size).toBe(0)
})

test('trace: epsilon handles floating-point drift over many small txs', () => {
  const txs: Transaction[] = []
  for (let i = 0; i < 1000; i++) {
    const dir = i % 2 === 0 ? 'In' : 'Out'
    txs.push(tx({ txHash: `t${i}`, blockTime: i + 1, date: new Date((i + 1) * 1000).toISOString(), qty: 0.1, dir, price: 1 }))
  }
  const { openLots } = computeFIFOWithTrace(txs, { ORCA: 1 })
  // After 500 ins of 0.1 + 500 outs of 0.1, queue should be empty (modulo epsilon)
  const totalRemaining = openLots.reduce((s, l) => s + l.qty, 0)
  expect(totalRemaining).toBeLessThan(1e-6)
})
