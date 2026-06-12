/**
 * Tests for the Birdeye client. globalThis.fetch is stubbed so we exercise
 * symbol↔mint mapping and response adaptation with no network.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { PRICE_MINTS } from './constants'

const realFetch = globalThis.fetch
let respond: (url: string) => { ok: boolean; status?: number; body: unknown }

beforeEach(() => {
  globalThis.fetch = (async (url: unknown) => {
    const { ok, status = 200, body } = respond(String(url))
    return { ok, status, json: async () => body } as Response
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const { getCurrentPrices, getHistoricalPrice, getDailyPrices } = await import('./birdeye')

test('getCurrentPrices maps mints back to symbols and drops non-positive', async () => {
  respond = (url) => {
    expect(url).toContain('/defi/multi_price')
    expect(url).toContain(PRICE_MINTS.SOL)
    return {
      ok: true,
      body: {
        success: true,
        data: {
          [PRICE_MINTS.SOL]: { value: 150.5 },
          [PRICE_MINTS.ORCA]: { value: 2.25 },
          [PRICE_MINTS.USDC]: { value: 0 },
        },
      },
    }
  }
  const out = await getCurrentPrices(['SOL', 'ORCA', 'USDC'])
  expect(out).toEqual({ SOL: 150.5, ORCA: 2.25 })
})

test('getCurrentPrices throws on non-200', async () => {
  respond = () => ({ ok: false, status: 429, body: {} })
  await expect(getCurrentPrices(['SOL'])).rejects.toThrow('Birdeye multi_price: 429')
})

test('getCurrentPrices returns {} when no token has a known mint', async () => {
  respond = () => {
    throw new Error('fetch should not be called')
  }
  const out = await getCurrentPrices(['DOGE'])
  expect(out).toEqual({})
})

test('getHistoricalPrice returns data.value', async () => {
  respond = (url) => {
    expect(url).toContain('/defi/historical_price_unix')
    expect(url).toContain('unixtime=1700000000')
    return { ok: true, body: { success: true, data: { value: 98.7 } } }
  }
  expect(await getHistoricalPrice('SOL', 1700000000)).toBe(98.7)
})

test('getHistoricalPrice returns null on non-200 and on unknown token', async () => {
  respond = () => ({ ok: false, status: 401, body: {} })
  expect(await getHistoricalPrice('SOL', 1700000000)).toBeNull()
  respond = () => {
    throw new Error('fetch should not be called')
  }
  expect(await getHistoricalPrice('DOGE', 1700000000)).toBeNull()
})

test('getDailyPrices adapts items[].{unixTime,value} → {timestamp,price}', async () => {
  respond = (url) => {
    expect(url).toContain('/defi/history_price')
    expect(url).toContain('type=1D')
    return {
      ok: true,
      body: {
        success: true,
        data: {
          items: [
            { unixTime: 1700000000, value: 100 },
            { unixTime: 1700086400, value: 0 },
            { unixTime: 1700172800, value: 102 },
          ],
        },
      },
    }
  }
  const pts = await getDailyPrices('SOL', 1700000000, 3)
  expect(pts).toEqual([
    { timestamp: 1700000000, price: 100 },
    { timestamp: 1700172800, price: 102 },
  ])
})

test('getDailyPrices requests an inclusive (span-1)-day window (days=points)', async () => {
  let seenUrl = ''
  respond = (url) => {
    seenUrl = url
    return { ok: true, body: { success: true, data: { items: [] } } }
  }
  await getDailyPrices('SOL', 1700000000, 3)
  // 3 points → time_to = start + 2*86400 = 1700172800
  expect(seenUrl).toContain('time_from=1700000000')
  expect(seenUrl).toContain('time_to=1700172800')
})

test('getCurrentPrices throws on success:false (200 body)', async () => {
  respond = () => ({ ok: true, body: { success: false, data: {} } })
  await expect(getCurrentPrices(['SOL'])).rejects.toThrow('success=false')
})

test('getCurrentPrices returns {} on 200 with missing data', async () => {
  respond = () => ({ ok: true, body: { success: true } })
  expect(await getCurrentPrices(['SOL'])).toEqual({})
})

test('getHistoricalPrice returns null on 200 with missing data.value', async () => {
  respond = () => ({ ok: true, body: { success: true, data: {} } })
  expect(await getHistoricalPrice('SOL', 1700000000)).toBeNull()
})

test('getDailyPrices returns [] on non-200 and on 200 with missing items', async () => {
  respond = () => ({ ok: false, status: 402, body: {} })
  expect(await getDailyPrices('SOL', 1700000000, 3)).toEqual([])
  respond = () => ({ ok: true, body: { success: true, data: {} } })
  expect(await getDailyPrices('SOL', 1700000000, 3)).toEqual([])
})
