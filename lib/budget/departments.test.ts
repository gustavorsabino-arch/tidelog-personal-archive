import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBudgetDepartmentName } from './departments.ts'

test('normalizes Governance into Legal; Council is no longer aliased', () => {
  assert.equal(normalizeBudgetDepartmentName('Governance'), 'Legal')
  assert.equal(normalizeBudgetDepartmentName('Council'), null)
})
