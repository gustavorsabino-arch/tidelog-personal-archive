import { test, expect } from 'bun:test'
import { resolveWalletGl } from './resolve-wallet-gl'

test('override wins over token and default', () => {
  expect(resolveWalletGl({ override: 'A', perToken: 'B', default: 'C' }))
    .toEqual({ code: 'A', source: 'override' })
})
test('per-token wins over default when no override', () => {
  expect(resolveWalletGl({ override: null, perToken: 'B', default: 'C' }))
    .toEqual({ code: 'B', source: 'token' })
})
test('default used when no override or per-token', () => {
  expect(resolveWalletGl({ override: null, perToken: null, default: 'C' }))
    .toEqual({ code: 'C', source: 'default' })
})
test('null code + null source when nothing maps', () => {
  expect(resolveWalletGl({ override: null, perToken: null, default: null }))
    .toEqual({ code: null, source: null })
})
test('empty strings are treated as unset', () => {
  expect(resolveWalletGl({ override: '', perToken: '', default: 'C' }))
    .toEqual({ code: 'C', source: 'default' })
})
