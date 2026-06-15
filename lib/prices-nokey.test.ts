/**
 * Covers the no-Birdeye-key path of the price wrapper: when hasBirdeyeKey is
 * false, Birdeye is never called and everything comes from DeFiLlama. (The
 * main lib/prices.test.ts mocks hasBirdeyeKey:true, so this needs its own
 * module-scoped mock.)
 */
import { test, expect, mock } from 'bun:test'

let birdeyeCalled = false

mock.module('@/lib/birdeye', () => ({
  hasBirdeyeKey: false,
  getCurrentPrices: async () => {
    birdeyeCalled = true
    return { SOL: 12345 }
  },
  getHistoricalPrice: async () => {
    birdeyeCalled = true
    return 12345
  },
  getDailyPrices: async () => {
    birdeyeCalled = true
    return [{ timestamp: 1, price: 12345 }]
  },
}))
mock.module('@/lib/defillama', () => ({
  getCurrentPrices: async (tokens: string[]) => {
    const out: Record<string, number> = {}
    for (const t of tokens) out[t] = 100
    return out
  },
  getHistoricalPrice: async () => 90,
  getDailyPrices: async () => [{ timestamp: 1, price: 99 }],
}))

const { getCurrentPrices, getHistoricalPrice, getDailyPrices } = await import('./prices')

test('no key: current prices come entirely from DeFiLlama, Birdeye never called', async () => {
  birdeyeCalled = false
  const { prices, sources } = await getCurrentPrices(['SOL', 'ORCA'])
  expect(prices).toEqual({ SOL: 100, ORCA: 100 })
  expect(sources).toEqual({ SOL: 'defillama', ORCA: 'defillama' })
  expect(birdeyeCalled).toBe(false)
})

test('no key: historical comes from DeFiLlama, Birdeye never called', async () => {
  birdeyeCalled = false
  expect(await getHistoricalPrice('SOL', 123)).toEqual({ price: 90, source: 'defillama' })
  expect(birdeyeCalled).toBe(false)
})

test('no key: daily comes from DeFiLlama, Birdeye never called', async () => {
  birdeyeCalled = false
  const { points, source } = await getDailyPrices('SOL', 1, 1)
  expect(points).toEqual([{ timestamp: 1, price: 99 }])
  expect(source).toBe('defillama')
  expect(birdeyeCalled).toBe(false)
})
