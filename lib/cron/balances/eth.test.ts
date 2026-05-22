import { test, expect, spyOn } from 'bun:test'
import { fetchEthBalances } from './eth'
import type { WalletRow } from './sol'

test('ETH stub returns skipped count and logs a warn line', async () => {
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  const wallets: WalletRow[] = [
    { address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chain: 'ETH', entityId: 'opco', isExternal: false },
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', chain: 'ETH', entityId: 'opco', isExternal: false },
  ]
  const res = await fetchEthBalances(wallets)
  expect(res.skipped).toBe(2)
  expect(res.succeeded).toBe(0)
  expect(res.failed).toBe(0)
  expect(warnSpy.mock.calls.some(c => String(c[0]).includes('[fetch-balances][ETH] stub'))).toBe(true)
  warnSpy.mockRestore()
})

test('ETH stub returns 0 skipped on empty wallet list', async () => {
  const res = await fetchEthBalances([])
  expect(res.skipped ?? 0).toBe(0)
})
