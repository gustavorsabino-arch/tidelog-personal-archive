import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBudgetLineAmounts, normalizeBudgetLineKey } from './catalog.ts'

test('normalizes legacy and display-style budget keys to canonical v1-shaped keys', () => {
  assert.equal(normalizeBudgetLineKey('salary'), 'salary')
  assert.equal(normalizeBudgetLineKey('Salaries & Wages'), 'salary')
  assert.equal(normalizeBudgetLineKey('Entity Compliance'), 'corpCompliance')
  assert.equal(normalizeBudgetLineKey('compliance'), 'corpCompliance')
  assert.equal(normalizeBudgetLineKey('Transaction Fees'), 'bankFees')
})

test('normalizes and merges aliased budget line amounts', () => {
  const normalized = normalizeBudgetLineAmounts({
    compliance: 10,
    corpCompliance: 15,
    'Salaries & Wages': 20,
    salary: 30,
  })

  assert.deepEqual(normalized, {
    corpCompliance: 25,
    salary: 50,
  })
})
