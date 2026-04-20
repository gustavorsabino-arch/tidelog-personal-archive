import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clampBudgetViewState,
  getDefaultBudgetViewState,
  getBudgetScopeMonthIndices,
  getBudgetScopePeriodLabel,
  getBudgetSelectableYears,
  getBudgetScopeYtdLabel,
  normalizeBudgetYear,
} from './scope.ts'
import type { BudgetViewState } from './types.ts'

test('builds ytd scope using the selected month plus a ytd rollup label', () => {
  const view: BudgetViewState = {
    year: 2026,
    entity: 'All',
    mode: 'ytd',
    month: 3,
    rangeStart: 0,
    rangeEnd: 3,
  }

  assert.deepEqual(getBudgetScopeMonthIndices(view), [3])
  assert.equal(getBudgetScopePeriodLabel(view), 'Apr')
  assert.equal(getBudgetScopeYtdLabel(view), 'Apr YTD')
})

test('builds month and range labels cleanly', () => {
  const monthView: BudgetViewState = {
    year: 2026,
    entity: 'All',
    mode: 'month',
    month: 1,
    rangeStart: 0,
    rangeEnd: 1,
  }

  const rangeView: BudgetViewState = {
    ...monthView,
    mode: 'range',
    rangeStart: 1,
    rangeEnd: 3,
  }

  assert.deepEqual(getBudgetScopeMonthIndices(monthView), [1])
  assert.equal(getBudgetScopePeriodLabel(monthView), 'Feb')
  assert.equal(getBudgetScopeYtdLabel(monthView), 'Feb YTD')
  assert.deepEqual(getBudgetScopeMonthIndices(rangeView), [1, 2, 3])
  assert.equal(getBudgetScopePeriodLabel(rangeView), 'Feb-Apr')
  assert.equal(getBudgetScopeYtdLabel(rangeView), 'Apr YTD')
})

test('clamps restricted viewer scope to allowed months, mode, and entity', () => {
  const view = clampBudgetViewState({
    year: 2026,
    entity: 'Opco',
    mode: 'range',
    month: 3,
    rangeStart: 2,
    rangeEnd: 5,
  }, {
    allowedMonthIndices: [0, 1],
    allowedModes: ['month'],
    allowedEntities: ['All'],
  })

  assert.equal(view.entity, 'All')
  assert.equal(view.mode, 'month')
  assert.equal(view.month, 1)
  assert.equal(view.rangeStart, 1)
  assert.equal(view.rangeEnd, 1)
})

test('builds a restricted default scope from the latest allowed closed month', () => {
  const view = getDefaultBudgetViewState(2026, {
    allowedMonthIndices: [0, 1],
    allowedModes: ['month'],
    allowedEntities: ['All'],
  })

  assert.equal(view.entity, 'All')
  assert.equal(view.mode, 'month')
  assert.equal(view.month, 1)
})

test('clamps budget years to 2026 or later', () => {
  const view = clampBudgetViewState({
    year: 2025,
    entity: 'All',
    mode: 'ytd',
    month: 1,
    rangeStart: 0,
    rangeEnd: 1,
  })

  assert.equal(normalizeBudgetYear(2025), 2026)
  assert.equal(getDefaultBudgetViewState(2025).year, 2026)
  assert.equal(view.year, 2026)
})

test('builds selectable budget years from 2026 onward', () => {
  assert.deepEqual(getBudgetSelectableYears(2026), [2026, 2027])
  assert.deepEqual(getBudgetSelectableYears(2028), [2026, 2027, 2028, 2029])
})
