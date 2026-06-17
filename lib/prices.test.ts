/**
 * Tests for the price wrapper. Both client modules are mocked at the module
 * boundary so we exercise the fallback decision + provenance tagging only.
 */
import { test, expect, mock, beforeEach } from 'bun:test'

let birdCurrent: Record<string, number> = {}
let birdCurrentThrows = false
let birdHist: number | null = null
let birdDaily: Array<{ timestamp: number; price: number }> = []
let lamaCurrent: Record<string, number> = {}
let lamaHist: number | null = null
let lamaDaily: Array<{ timestamp: number; price: number }> = []
let lastHistTs = -1

mock.module('@/lib/birdeye', () => ({
  hasBirdeyeKey: true,
  getCurrentPrices: async (tokens: string[]) => {
    if (birdCurrentThrows) throw new Error('boom')
    const out: Record<string, number> = {}
    for (const t of tokens) if (birdCurrent[t] != null) out[t] = birdCurrent[t]
    return out
  },
  getHistoricalPrice: async (_token: string, ts: number) => { lastHistTs = ts; return birdHist },
  getDailyPrices: async () => birdDaily,
}))
mock.module('@/lib/defillama', () => ({
  getCurrentPrices: async (tokens: string[]) => {
    const out: Record<string, number> = {}
    for (const t of tokens) if (lamaCurrent[t] != null) out[t] = lamaCurrent[t]
    return out
  },
  getHistoricalPrice: async () => lamaHist,
  getDailyPrices: async () => lamaDaily,
}))

const { getCurrentPrices, getHistoricalPrice, getDailyPrices, getClosingPrice } = await import('./prices')

beforeEach(() => {
  birdCurrent = {}
  birdCurrentThrows = false
  birdHist = null
  birdDaily = []
  lamaCurrent = {}
  lamaHist = null
  lamaDaily = []
  lastHistTs = -1
})

test('current: per-token fallback — Birdeye serves what it can, DeFiLlama fills gaps', async () => {
  birdCurrent = { SOL: 150 }
  lamaCurrent = { SOL: 999, ORCA: 2 } // SOL should NOT come from lama (bird won)
  const { prices, sources } = await getCurrentPrices(['SOL', 'ORCA'])
  expect(prices).toEqual({ SOL: 150, ORCA: 2 })
  expect(sources).toEqual({ SOL: 'birdeye', ORCA: 'defillama' })
})

test('current: Birdeye throwing routes ALL tokens to DeFiLlama', async () => {
  birdCurrentThrows = true
  lamaCurrent = { SOL: 150, ORCA: 2 }
  const { prices, sources } = await getCurrentPrices(['SOL', 'ORCA'])
  expect(prices).toEqual({ SOL: 150, ORCA: 2 })
  expect(sources).toEqual({ SOL: 'defillama', ORCA: 'defillama' })
})

test('current: token missing from both providers is omitted', async () => {
  birdCurrent = { SOL: 150 }
  lamaCurrent = { SOL: 150 }
  const { prices, sources } = await getCurrentPrices(['SOL', 'ORCA'])
  expect(prices).toEqual({ SOL: 150 })
  expect(sources).toEqual({ SOL: 'birdeye' })
})

test('historical: Birdeye hit tags birdeye', async () => {
  birdHist = 100
  lamaHist = 90
  expect(await getHistoricalPrice('SOL', 123)).toEqual({ price: 100, source: 'birdeye' })
})

test('historical: Birdeye null falls back to DeFiLlama', async () => {
  birdHist = null
  lamaHist = 90
  expect(await getHistoricalPrice('SOL', 123)).toEqual({ price: 90, source: 'defillama' })
})

test('historical: both miss returns null', async () => {
  birdHist = null
  lamaHist = null
  expect(await getHistoricalPrice('SOL', 123)).toBeNull()
})

test('daily: Birdeye points tag birdeye; empty falls back to DeFiLlama', async () => {
  birdDaily = [{ timestamp: 1, price: 10 }]
  lamaDaily = [{ timestamp: 1, price: 99 }]
  expect(await getDailyPrices('SOL', 1, 1)).toEqual({
    points: [{ timestamp: 1, price: 10 }],
    source: 'birdeye',
  })

  birdDaily = []
  expect(await getDailyPrices('SOL', 1, 1)).toEqual({
    points: [{ timestamp: 1, price: 99 }],
    source: 'defillama',
  })
})

test('getClosingPrice queries 23:59:55 UTC (dayStart + 86395), NOT midnight', async () => {
  birdHist = 68.9
  const noon = Math.floor(Date.parse('2026-06-13T12:00:00Z') / 1000)
  const res = await getClosingPrice('SOL', noon)
  const dayStart = Math.floor(Date.parse('2026-06-13T00:00:00Z') / 1000)
  expect(lastHistTs).toBe(dayStart + 86395)
  expect(res).toEqual({ price: 68.9, source: 'birdeye' })
})

test('getClosingPrice falls back to DeFiLlama when Birdeye misses', async () => {
  birdHist = null
  lamaHist = 67.2
  const noon = Math.floor(Date.parse('2026-06-13T12:00:00Z') / 1000)
  expect(await getClosingPrice('SOL', noon)).toEqual({ price: 67.2, source: 'defillama' })
})

test('getClosingPrice returns null for the current/future UTC day (close not final yet)', async () => {
  birdHist = 100
  lamaHist = 100
  const future = Math.floor(Date.parse('2099-01-01T12:00:00Z') / 1000)
  expect(await getClosingPrice('SOL', future)).toBeNull()
})
