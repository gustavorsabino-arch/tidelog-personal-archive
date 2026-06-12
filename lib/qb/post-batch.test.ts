import { test, expect } from 'bun:test'
import { resolveWalletGl } from './resolve-wallet-gl'
import { groupDescription } from './post-batch'

test('no per-token mapping ⇒ same code as override ?? default (pre-change behavior)', () => {
  const override = null
  const def = '1010'
  expect(resolveWalletGl({ override, perToken: null, default: def }).code).toBe(override ?? def)
})

test('per-token mapping wins over the wallet default', () => {
  expect(resolveWalletGl({ override: null, perToken: '1132914', default: '1010' }))
    .toEqual({ code: '1132914', source: 'token' })
})

// groupDescription → the JE Memo + every line's Description (post-batch + preview).
// Individual returns the tx's effective description; bulk synthesizes a
// direction-aware group summary (IN / OUT / MIXED, gross totals, 2-dp qty).
const bulkMember = (dir: 'in' | 'out', qty: number, usd: number) =>
  ({ direction: dir, qty, usd } as never)
const bulkGroup = (token: string, members: unknown[]) =>
  ({ kind: 'bulk', token, monthYyyymm: '2026-05', members } as never)

test('groupDescription(individual) returns the tx description verbatim', () => {
  const g = { kind: 'individual', tx: { description: 'In - USDC - 1.00 - $1.00 - 0xabc' } } as never
  expect(groupDescription(g)).toBe('In - USDC - 1.00 - $1.00 - 0xabc')
})

test('groupDescription(bulk) all inflow ⇒ IN prefix, summed gross totals', () => {
  const g = bulkGroup('USDC', [bulkMember('in', 100, 100), bulkMember('in', 23, 23)])
  expect(groupDescription(g)).toBe('IN - USDC - 123.00 USDC - $123.00 - 2026-05 - 2 txs')
})

test('groupDescription(bulk) all outflow ⇒ OUT prefix', () => {
  const g = bulkGroup('ORCA', [bulkMember('out', 5, 50)])
  expect(groupDescription(g)).toBe('OUT - ORCA - 5.00 ORCA - $50.00 - 2026-05 - 1 txs')
})

test('groupDescription(bulk) mixed directions ⇒ MIXED (N in/M out), gross (abs) totals', () => {
  const g = bulkGroup('SOL', [bulkMember('in', 10, 1000), bulkMember('in', 5, 500), bulkMember('out', 2.5, 250)])
  expect(groupDescription(g)).toBe('MIXED (2 in/1 out) - SOL - 17.50 SOL - $1,750.00 - 2026-05 - 3 txs')
})
