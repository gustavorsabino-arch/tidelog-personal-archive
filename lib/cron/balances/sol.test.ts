import { test, expect, mock } from 'bun:test'

// Stub modules that require DB / external config so fetchSolBalances
// can be imported without a live database or Helius API key.
mock.module('@/lib/db', () => ({ db: {} }))
mock.module('@/lib/db/schema', () => ({ token: {}, balanceSnapshot: {} }))
mock.module('@/lib/helius', () => ({
  heliusRpc: async () => ({ result: { value: [] } }),
}))
mock.module('@/lib/constants', () => ({
  getSym: () => null,
}))

import { fetchSolBalances, type WalletRow, type FetchBalancesResult } from './sol'

test('fetchSolBalances returns the expected shape for an empty wallet list', async () => {
  const res: FetchBalancesResult = await fetchSolBalances([])
  expect(res.succeeded).toBe(0)
  expect(res.failed).toBe(0)
})

test('WalletRow type accepts the columns we read', () => {
  const row: WalletRow = {
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    chain: 'SOL',
    entityId: 'opco',
    isExternal: false,
  }
  expect(row.address).toBeDefined()
})
