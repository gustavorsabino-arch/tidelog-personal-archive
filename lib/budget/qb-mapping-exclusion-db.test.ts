import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeExclusionRow } from './qb-mapping-exclusion-db.ts'

test('normalizeExclusionRow coerces accountNumber to a trimmed string and serializes updatedAt', () => {
  const result = normalizeExclusionRow({
    qbAccountNumber: '  61010 ',
    reason: 'Do not map to budget',
    updatedAt: new Date('2026-05-25T18:00:00Z'),
  })
  assert.deepEqual(result, {
    accountNumber: '61010',
    reason: 'Do not map to budget',
    updatedAt: '2026-05-25T18:00:00.000Z',
  })
})

test('normalizeExclusionRow handles a null updatedAt', () => {
  const result = normalizeExclusionRow({
    qbAccountNumber: '40110',
    reason: 'Revenue — out of budget scope',
    updatedAt: null as unknown as Date,
  })
  assert.equal(result.accountNumber, '40110')
  assert.equal(result.reason, 'Revenue — out of budget scope')
  assert.equal(result.updatedAt, null)
})
