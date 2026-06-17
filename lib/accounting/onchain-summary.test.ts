import { test, expect, mock, beforeEach } from 'bun:test'

// --- mock @/lib/prices before importing the module under test ---
mock.module('@/lib/prices', () => ({
  getCurrentPrices: async () => ({ prices: { SOL: 75 }, sources: { SOL: 'birdeye' } }),
  getClosingPrice: async () => ({ price: 75, source: 'birdeye' }),
}))

// --- mock @/lib/db ---
// db.select().from().where() is a thenable chain. We track call count to
// distinguish the wallet query (1st) from the snapshot query (2nd).
let dbCallCount = 0

function makeChain(result: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    then: (
      resolve?: ((v: unknown[]) => unknown) | null,
      reject?: ((e: unknown) => unknown) | null,
    ) => Promise.resolve(result).then(resolve ?? undefined, reject ?? undefined),
  }
  return chain
}

mock.module('@/lib/db', () => ({
  db: {
    select: () => {
      dbCallCount += 1
      const callIndex = dbCallCount
      // 1st call → wallet query → return one internal wallet
      // 2nd call → snapshot query → return empty (triggers early return with kind set)
      return makeChain(callIndex === 1 ? [{ address: 'W1' }] : [])
    },
  },
}))

// mock server-only so the 'server-only' import doesn't throw in test
mock.module('server-only', () => ({}))

const { getEntityOnchainSummary } = await import('./onchain-summary')

beforeEach(() => {
  dbCallCount = 0
})

test('live summary carries kind=live', async () => {
  const res = await getEntityOnchainSummary('opco', null)
  expect(res.kind).toBe('live')
})

test('as-of summary carries kind=close', async () => {
  const res = await getEntityOnchainSummary('opco', '2026-06-13')
  expect(res.kind).toBe('close')
})

test('live summary with no snapshots returns empty byToken', async () => {
  const res = await getEntityOnchainSummary('opco', null)
  expect(res.byToken).toEqual([])
})
