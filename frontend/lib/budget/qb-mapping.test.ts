import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_BUDGET_QB_MAPPING_ROWS,
  findBudgetQbMappingDuplicates,
  getBudgetQbMappingPath,
  normalizeBudgetQbMappingState,
  validateBudgetQbMappingRows,
} from './qb-mapping.ts'

test('normalizes and merges duplicate QB mapping rows by canonical key', () => {
  const mapping = normalizeBudgetQbMappingState({
    rows: [
      { key: 'compliance', line: 'Compliance', cat: 'Professional Services', accounts: [62040, '62040'] as unknown as number[] },
      { key: 'corpCompliance', line: 'Corporate Compliance', cat: 'Professional Services', accounts: [62041] },
    ],
  }, 2026, 'data-branch')

  assert.equal(mapping.source, 'data-branch')
  assert.equal(mapping.rows.length, 1)
  assert.equal(mapping.rows[0]?.key, 'corpCompliance')
  assert.deepEqual(mapping.rows[0]?.accounts, [62040, 62041])
})

test('falls back to default QB mapping rows when no rows are present', () => {
  const mapping = normalizeBudgetQbMappingState({ rows: [] }, 2026, 'data-branch')

  assert.equal(mapping.rows.length, DEFAULT_BUDGET_QB_MAPPING_ROWS.length)
  assert.equal(mapping.rows[0]?.key, DEFAULT_BUDGET_QB_MAPPING_ROWS[0]?.key)
})

test('builds a year-aware QB mapping path', () => {
  assert.equal(getBudgetQbMappingPath(2026), 'budget/2026/qb-mapping.json')
})

test('detects duplicate account assignments across different budget lines', () => {
  const duplicates = findBudgetQbMappingDuplicates([
    { key: 'salary', line: 'Salaries & Wages', cat: 'Compensation & Benefits', accounts: [60110] },
    { key: 'bonus', line: 'Bonus', cat: 'Compensation & Benefits', accounts: [60110, 60320] },
  ])

  assert.deepEqual(duplicates, [
    {
      accountNumber: 60110,
      lineKeys: ['salary', 'bonus'],
      lineLabels: ['Salaries & Wages', 'Bonus'],
    },
  ])
})

test('rejects duplicate account assignments during validation', () => {
  assert.throws(
    () => validateBudgetQbMappingRows([
      { key: 'salary', line: 'Salaries & Wages', cat: 'Compensation & Benefits', accounts: [60110] },
      { key: 'bonus', line: 'Bonus', cat: 'Compensation & Benefits', accounts: [60110] },
    ]),
    /mapped to multiple budget lines/i,
  )
})
