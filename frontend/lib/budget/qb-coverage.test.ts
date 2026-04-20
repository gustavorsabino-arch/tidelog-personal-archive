import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBudgetCoverageState } from './qb-coverage-model.ts'
import type { BudgetViewState } from './types.ts'

const VIEW: BudgetViewState = {
  year: 2026,
  entity: 'All',
  mode: 'ytd',
  month: 3,
  rangeStart: 0,
  rangeEnd: 2,
}

test('builds mapped and unmapped coverage totals from QB account totals', () => {
  const coverage = buildBudgetCoverageState(
    VIEW,
    [
      { key: 'salary', line: 'Salaries & Wages', cat: 'Compensation & Benefits', accounts: [60110] },
      { key: 'hosting', line: 'Cloud Hosting & Compute', cat: 'Hosting & Infrastructure', accounts: [61110] },
    ],
    {
      '60110': 100,
      '61110': 50,
      '69999': 25,
    },
    {
      '60110': 'Payroll',
      '61110': 'AWS',
      '69999': 'Misc Clearing',
    },
    'data-branch',
  )

  assert.equal(coverage.totalQbUsd, 175)
  assert.equal(coverage.mappedUsd, 150)
  assert.equal(coverage.unmappedUsd, 25)
  assert.equal(Number(coverage.coveragePct.toFixed(4)), Number((150 / 175).toFixed(4)))
  assert.equal(coverage.mappedAccounts[0]?.mappingLine, 'Salaries & Wages')
  assert.equal(coverage.unmappedAccounts[0]?.accountNumber, '69999')
})

test('ignores non-positive account balances when building coverage', () => {
  const coverage = buildBudgetCoverageState(
    VIEW,
    [],
    {
      '60110': 0,
      '69999': -20,
      '70000': 10,
    },
    {
      '70000': 'Positive Expense',
    },
    'default-static',
  )

  assert.equal(coverage.totalQbUsd, 10)
  assert.equal(coverage.unmappedAccounts.length, 1)
  assert.equal(coverage.unmappedAccounts[0]?.accountNumber, '70000')
})
