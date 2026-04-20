import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBudgetQboClassName, normalizeBudgetQboClassToken } from './qb-class.ts'

test('normalizes QBO class tokens consistently', () => {
  assert.equal(normalizeBudgetQboClassToken('Finance & Accounting'), 'finance and accounting')
  assert.equal(normalizeBudgetQboClassToken('General:General - Team Colo'), 'general general team colo')
})

test('maps direct and aliased QBO class names to budget departments', () => {
  assert.equal(normalizeBudgetQboClassName('Engineering'), 'Engineering')
  assert.equal(normalizeBudgetQboClassName('Finance'), 'Finance')
  assert.equal(normalizeBudgetQboClassName('Finance & Accounting'), 'Finance')
  assert.equal(normalizeBudgetQboClassName('General:General - Team Colo'), 'General')
  assert.equal(normalizeBudgetQboClassName('BD'), 'Business Development')
})

test('returns null for empty or unknown QBO classes', () => {
  assert.equal(normalizeBudgetQboClassName(''), null)
  assert.equal(normalizeBudgetQboClassName('Unmapped Internal Ops'), null)
})
