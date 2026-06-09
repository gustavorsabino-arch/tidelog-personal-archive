import { test, expect } from 'bun:test'
import { resolveWalletGl } from './resolve-wallet-gl'

test('no per-token mapping ⇒ same code as override ?? default (pre-change behavior)', () => {
  const override = null
  const def = '1010'
  expect(resolveWalletGl({ override, perToken: null, default: def }).code).toBe(override ?? def)
})

test('per-token mapping wins over the wallet default', () => {
  expect(resolveWalletGl({ override: null, perToken: '1132914', default: '1010' }))
    .toEqual({ code: '1132914', source: 'token' })
})
