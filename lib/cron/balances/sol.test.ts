import { test, expect } from 'bun:test'
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
    type: 'internal' as const,
    hiddenFromFinance: false,
  }
  expect(row.address).toBeDefined()
})
