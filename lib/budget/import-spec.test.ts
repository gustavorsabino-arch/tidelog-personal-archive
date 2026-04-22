import test from 'node:test'
import assert from 'node:assert/strict'

import { BUDGET_DEPTS } from '../constants.ts'
import {
  describeBudgetImportWorkbookRequirements,
  getBudgetImportWorkbookGuide,
} from './import-spec.ts'

test('describes the real v1 all-departments workbook contract', () => {
  const guide = getBudgetImportWorkbookGuide('All')
  const description = describeBudgetImportWorkbookRequirements('All')

  assert.equal(guide.workbookCount, 1)
  assert.deepEqual(guide.requiredDepartmentSheets, BUDGET_DEPTS)
  assert.deepEqual(guide.sheetAliases, [{ sheetName: 'Finance & Accounting', department: 'Finance' }])
  assert.equal(guide.monthHeaderScanLimit, 10)
  assert.equal(guide.minimumMonthHeaders, 3)
  assert.match(description, /8 department sheets/i)
  assert.match(description, /General, Ops, Finance, Legal, Product, Engineering, Marketing, Business Development/i)
  assert.match(description, /Jan-Dec/i)
  assert.match(description, /column C/i)
  assert.match(description, /column B/i)
})

test('describes the single-department fallback workbook contract', () => {
  const guide = getBudgetImportWorkbookGuide('Engineering')
  const description = describeBudgetImportWorkbookRequirements('Engineering')

  assert.deepEqual(guide.fallbackSheetNames, ['BudgetbyMonth', 'BudgetByMonth', 'Budget', 'Sheet1'])
  assert.match(description, /sheet named Engineering/i)
  assert.match(description, /BudgetbyMonth, BudgetByMonth, Budget, Sheet1/i)
  assert.match(description, /split across multiple budget-category tabs/i)
  assert.match(description, /Finance & Accounting for Finance/i)
})
