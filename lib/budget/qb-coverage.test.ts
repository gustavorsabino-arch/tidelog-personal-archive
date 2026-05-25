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
    [],
    new Set(['60110', '61110', '69999']),
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
    [],
    new Set(['70000']),
  )

  assert.equal(coverage.totalQbUsd, 10)
  assert.equal(coverage.unmappedAccounts.length, 1)
  assert.equal(coverage.unmappedAccounts[0]?.accountNumber, '70000')
})

test('puts intentionally excluded accounts in their own bucket and removes them from the denominator', () => {
  const coverage = buildBudgetCoverageState(
    VIEW,
    [
      { key: 'salary', line: 'Salaries & Wages', cat: 'Compensation & Benefits', accounts: [60110] },
    ],
    {
      '60110': 100,
      '40110': 500, // excluded — revenue out of scope
      '69999': 50,  // unmapped
    },
    {
      '60110': 'Payroll',
      '40110': 'Core Product Revenue',
      '69999': 'Misc Clearing',
    },
    'data-branch',
    [{ accountNumber: '40110', reason: 'Do not map to budget', updatedAt: null }],
    new Set(['60110', '40110', '69999']),
  )

  assert.equal(coverage.totalQbUsd, 150, 'denominator excludes the 500 excluded amount')
  assert.equal(coverage.mappedUsd, 100)
  assert.equal(coverage.unmappedUsd, 50)
  assert.equal(coverage.excludedUsd, 500)
  assert.equal(Number(coverage.coveragePct.toFixed(4)), Number((100 / 150).toFixed(4)))
  assert.equal(coverage.excludedAccounts.length, 1)
  assert.equal(coverage.excludedAccounts[0]?.accountNumber, '40110')
  assert.equal(coverage.excludedAccounts[0]?.exclusionReason, 'Do not map to budget')
})

test('flags mapped accounts with no period activity as stale, and orphans them when missing from catalog', () => {
  const coverage = buildBudgetCoverageState(
    VIEW,
    [
      { key: 'salary', line: 'Salaries & Wages', cat: 'Compensation & Benefits', accounts: [60110, 60111] },
      { key: 'hosting', line: 'Cloud Hosting & Compute', cat: 'Hosting & Infrastructure', accounts: [61110] },
    ],
    {
      '60110': 100,
      // 60111 has no activity → stale; still in catalog → not orphaned
      // 61110 has no activity → stale; NOT in catalog → orphaned
    },
    {
      '60110': 'Payroll',
      '60111': 'Payroll Sub',
    },
    'data-branch',
    [],
    new Set(['60110', '60111']),
  )

  const stale = coverage.staleMappings
  assert.equal(stale.length, 2, 'both inactive mapped accounts are stale')
  const byAccount = Object.fromEntries(stale.map((s) => [s.accountNumber, s]))
  assert.equal(byAccount['60111']?.inCatalog, true)
  assert.equal(byAccount['60111']?.accountName, 'Payroll Sub')
  assert.equal(byAccount['61110']?.inCatalog, false)
  assert.equal(byAccount['61110']?.accountName, null, 'account missing from catalog has null name')
  assert.equal(coverage.orphanedMappings.length, 1)
  assert.equal(coverage.orphanedMappings[0]?.accountNumber, '61110')
})
