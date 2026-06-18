import { test, expect } from 'bun:test'
import { planReprice } from './plan'

const row = { id: 'r1', asset: 'ORCA', blockTime: 1700000000, qty: -10, price: '0.80', usd: '8.00', priceSource: 'cache' }

test('reprice on a found price: usd = abs(qty)*price, backup captures originals, real source', () => {
  const a = planReprice(row, { price: 1.5, source: 'birdeye' })
  expect(a).toEqual({
    kind: 'reprice',
    price: 1.5,
    usd: 15,
    source: 'birdeye',
    backup: { oldPrice: '0.80', oldUsd: '8.00', oldPriceSource: 'cache' },
  })
})

test('defillama-sourced price keeps source=defillama', () => {
  const a = planReprice({ ...row, qty: 2 }, { price: 70, source: 'defillama' })
  expect(a.kind).toBe('reprice')
  if (a.kind === 'reprice') { expect(a.source).toBe('defillama'); expect(a.usd).toBe(140) }
})

test('null / non-positive lookup → fail', () => {
  expect(planReprice(row, null).kind).toBe('fail')
  expect(planReprice(row, { price: 0, source: 'birdeye' }).kind).toBe('fail')
})

test('re-prices even when the row already has a price (cache rows do)', () => {
  const a = planReprice({ ...row, price: '0.80', usd: '8.00' }, { price: 1.2, source: 'birdeye' })
  expect(a.kind).toBe('reprice')
})
