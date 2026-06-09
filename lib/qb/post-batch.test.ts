import { test, expect } from 'bun:test'
import { resolveWalletGl } from './resolve-wallet-gl'

test('no per-token mapping ⇒ same code as override ?? default (pre-change behavior)', () => {
  const override = null, def = '1010'
  expect(resolveWalletGl({ override, perToken: null, default: def }).code).toBe(override ?? def)
})
