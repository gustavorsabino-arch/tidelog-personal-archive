import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBudgetQboClassName, normalizeBudgetQboClassToken, isExcludedBudgetQboClassName } from './qb-class.ts'

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

test('isExcludedBudgetQboClassName matches Council at any depth, case-insensitive', () => {
  assert.equal(isExcludedBudgetQboClassName('Council'), true)
  assert.equal(isExcludedBudgetQboClassName('council'), true)
  assert.equal(isExcludedBudgetQboClassName('  Council  '), true)
  assert.equal(isExcludedBudgetQboClassName('Council:Anything'), true)
  assert.equal(isExcludedBudgetQboClassName('council:foo'), true)
  assert.equal(isExcludedBudgetQboClassName('Legal:Council'), true)
  assert.equal(isExcludedBudgetQboClassName('Foo:Council:Bar'), true)
})

test('isExcludedBudgetQboClassName rejects empty, unrelated, and substring matches', () => {
  assert.equal(isExcludedBudgetQboClassName(''), false)
  assert.equal(isExcludedBudgetQboClassName(null), false)
  assert.equal(isExcludedBudgetQboClassName(undefined), false)
  assert.equal(isExcludedBudgetQboClassName('Legal'), false)
  assert.equal(isExcludedBudgetQboClassName('Governance'), false)
  assert.equal(isExcludedBudgetQboClassName('General'), false)
  assert.equal(isExcludedBudgetQboClassName('Councilman'), false)
  assert.equal(isExcludedBudgetQboClassName('Council Members'), false)
  assert.equal(isExcludedBudgetQboClassName('Pre-Council Review'), false)
})
