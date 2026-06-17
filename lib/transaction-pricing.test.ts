import { test, expect, mock, beforeEach } from 'bun:test'
import type { Transaction } from './types'

// Mock the price PROVIDERS (not @/lib/prices) so the real wrapper is exercised.
// Mocking @/lib/prices directly leaks across files (bun module mocks are
// process-global) and breaks prices.test.ts, which imports the real wrapper —
// so we mock the same lower layer prices.test.ts mocks instead.
let birdHist: Record<string, number> = {} // `${token}::${ts}` → Birdeye price
let lamaHist: Record<string, number> = {} // DeFiLlama fallback price
let birdCalls = 0

mock.module('@/lib/birdeye', () => ({
  hasBirdeyeKey: true,
  getCurrentPrices: async () => ({}),
  getHistoricalPrice: async (token: string, ts: number) => {
    birdCalls++
    return birdHist[`${token}::${ts}`] ?? null
  },
  getDailyPrices: async () => [],
}))
mock.module('@/lib/defillama', () => ({
  getCurrentPrices: async () => ({}),
  getHistoricalPrice: async (token: string, ts: number) => lamaHist[`${token}::${ts}`] ?? null,
  getDailyPrices: async () => [],
}))

const { hydrateTransactionPrices } = await import('./transaction-pricing')

// Minimal Transaction — field names match lib/types.ts.
function tx(over: Partial<Transaction>): Transaction {
  return {
    txHash: 'h', walletAddr: 'w', wallet: 'w', entity: 'e', blockTime: 1700000000,
    date: '2023-11-15', asset: 'ORCA', qty: 0, dir: 'In', price: null, usd: null, priceSource: null,
    counterparty: null, category: null,
    ...over,
  } as Transaction
}

beforeEach(() => { birdHist = {}; lamaHist = {}; birdCalls = 0 })

test('prices a non-stable tx at its exact block second + persists source=birdeye', async () => {
  birdHist = { 'ORCA::1700000000': 1.5 }
  const { transactions } = await hydrateTransactionPrices(
    [tx({ asset: 'ORCA', blockTime: 1700000000, qty: 10 })], { priceCache: {} })
  expect(transactions[0].price).toBe(1.5)
  expect(transactions[0].priceSource).toBe('birdeye')
  expect(transactions[0].usd).toBe(15)
})

test('per-run cache dedups identical (asset, second) — one lookup for two txs', async () => {
  birdHist = { 'ORCA::1700000000': 2 }
  await hydrateTransactionPrices(
    [tx({ asset: 'ORCA', blockTime: 1700000000, qty: 1 }), tx({ asset: 'ORCA', blockTime: 1700000000, qty: 5 })],
    { priceCache: {} })
  expect(birdCalls).toBe(1)
})

test('stablecoin short-circuits to $1 / stable, no lookup', async () => {
  const { transactions } = await hydrateTransactionPrices(
    [tx({ asset: 'USDC', blockTime: 1700000000, qty: 100 })], { priceCache: {} })
  expect(transactions[0].price).toBe(1)
  expect(transactions[0].priceSource).toBe('stable')
  expect(transactions[0].usd).toBe(100)
  expect(birdCalls).toBe(0)
})

test('both providers miss → no price; miss cached, no re-query', async () => {
  const { transactions } = await hydrateTransactionPrices(
    [tx({ asset: 'ORCA', blockTime: 1700000000, qty: 1 }), tx({ asset: 'ORCA', blockTime: 1700000000, qty: 2 })],
    { priceCache: {} })
  expect(transactions[0].price).toBeNull()
  expect(transactions[0].priceSource).toBeNull()
  expect(birdCalls).toBe(1) // miss cached → second tx did not re-query
})

test('Birdeye miss → DeFiLlama fallback persists source=defillama', async () => {
  lamaHist = { 'SOL::1700000000': 70 } // birdHist empty → Birdeye null → DeFiLlama
  const { transactions } = await hydrateTransactionPrices(
    [tx({ asset: 'SOL', blockTime: 1700000000, qty: 2 })], { priceCache: {} })
  expect(transactions[0].price).toBe(70)
  expect(transactions[0].priceSource).toBe('defillama')
})

test('already-priced tx is left untouched (no re-price)', async () => {
  birdHist = { 'ORCA::1700000000': 99 }
  const { transactions } = await hydrateTransactionPrices(
    [tx({ asset: 'ORCA', blockTime: 1700000000, qty: 1, price: 5, usd: 5, priceSource: 'cache' })], { priceCache: {} })
  expect(transactions[0].price).toBe(5)
  expect(transactions[0].priceSource).toBe('cache')
  expect(birdCalls).toBe(0)
})
