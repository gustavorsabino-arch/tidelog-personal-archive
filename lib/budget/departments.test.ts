import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBudgetDepartmentName } from './departments.ts'

test('normalizes Zagreus legal class aliases into the Legal department', () => {
  assert.equal(normalizeBudgetDepartmentName('Governance'), 'Legal')
  assert.equal(normalizeBudgetDepartmentName('Council'), 'Legal')
})
