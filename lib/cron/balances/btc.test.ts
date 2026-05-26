import { test, expect, spyOn } from 'bun:test'
import { fetchBtcBalances } from './btc'
import type { WalletRow } from './sol'

test('BTC stub returns skipped count and logs a warn line', async () => {
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  const wallets: WalletRow[] = [
    { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', chain: 'BTC', entityId: 'opco', type: 'internal' as const, hiddenFromFinance: false },
  ]
  const res = await fetchBtcBalances(wallets)
  expect(res.skipped).toBe(1)
  expect(warnSpy.mock.calls.some(c => String(c[0]).includes('[fetch-balances][BTC] stub'))).toBe(true)
  warnSpy.mockRestore()
})

test('BTC stub returns zeros for empty list', async () => {
  const res = await fetchBtcBalances([])
  expect(res).toEqual({ succeeded: 0, failed: 0, skipped: 0 })
})
