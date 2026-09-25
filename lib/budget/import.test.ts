import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'

import {
  clearDepartmentPeriods,
  clearDepartmentPeriod,
  diffBudgetLineAmounts,
  getBudgetImportExistingPeriodsToReplace,
  getBudgetDepartmentPlanPath,
  mergeDepartmentPeriod,
  parseBudgetLineKey,
  parseBudgetSheetRows,
  parseBudgetWorkbook,
  prepareDepartmentPlanForImport,
  mergeDepartmentPeriods,
  isMonthScopedWorkbook,
} from './import.ts'
import type { BudgetDepartmentPlan } from './types.ts'

test('maps known line-item aliases to canonical keys', () => {
  assert.equal(parseBudgetLineKey('Business Tools'), 'bizTools')
  assert.equal(parseBudgetLineKey('Entity Compliance'), 'corpCompliance')
  assert.equal(parseBudgetLineKey('Salaries & Wages'), 'salary')
  assert.equal(parseBudgetLineKey('Unknown Custom Line'), 'unknown_custom_line')
})

test('parses fallback row/column sheet layout from the engineering sample format', () => {
  const rows = [
    [],
    [],
    [],
    [],
    [],
    [],
    ['', '', 'Cloud Hosting & Compute', 480000],
    ['', '', 'Department Tools', '$115,000'],
    ['', '', 'Travel', 5000],
    ['', '', 'Total', 600000],
  ]

  const result = parseBudgetSheetRows(rows)
  assert.deepEqual(result.lines, {
    hosting: 480000,
    epdTools: 115000,
    travel: 5000,
  })
  assert.equal(result.rowsProcessed, 3)
  assert.equal(result.isValid, true)
})

test('parses workbook sheets by department name and reports missing departments', () => {
  const workbook = XLSX.utils.book_new()
  const engineeringSheet = XLSX.utils.aoa_to_sheet([
    ['Line Item', 'Budget'],
    ['Cloud Hosting & Compute', 480000],
    ['Department Tools', 115000],
  ])
  XLSX.utils.book_append_sheet(workbook, engineeringSheet, 'Engineering')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'All')

  assert.equal(parsed.departments.length, 1)
  assert.equal(parsed.departments[0]?.department, 'Engineering')
  assert.ok(parsed.departmentsMissing.includes('General'))
  assert.equal(parsed.invalidSheets.length, 0)
})

test('maps legacy Finance & Accounting sheet names onto the canonical Finance department', () => {
  const workbook = XLSX.utils.book_new()
  const financeSheet = XLSX.utils.aoa_to_sheet([
    ['Line Item', 'Budget'],
    ['Professional Services', 120000],
  ])
  XLSX.utils.book_append_sheet(workbook, financeSheet, 'Finance & Accounting')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'All')

  assert.equal(parsed.departments[0]?.department, 'Finance')
  assert.equal(parsed.departments[0]?.lines.profSvc, 120000)
})

test('captures top-level monthly rows whose label sits in column 0', () => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Jan', 'Feb', 'Mar'],
    ['', '', 'Salaries & Wages', 100, 100, 100],
    ['Travel & Entertainment', '', '', 25, 30, 45],
    ['Office', '', '', 0, 50, 0],
    ['', '', 'Industry Relations', 10, 20, 30],
    ['Contingency', '', '', 5, 5, 5],
    ['Total Expenses', '', '', 140, 205, 180],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Engineering')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Engineering', 'annual')
  const dept = parsed.departments[0]
  assert.equal(dept?.lines.salary, 300)
  assert.equal(dept?.lines.travel, 100)
  assert.equal(dept?.lines.rent, 50)
  assert.equal(dept?.lines.industryRelations, 60)
  assert.equal(dept?.lines.contingency, 15)
  assert.equal(dept?.unmappedLineItems.length, 0)
})

test('isMonthScopedWorkbook: true when every parsed department is monthly-columns', () => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Oct', 'Nov', 'Dec'],
    ['', '', 'Cloud Hosting & Compute', 100, 150, 200],
    ['', '', 'Department Tools', 25, 30, 45],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Engineering')
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Engineering', 'annual')

  assert.deepEqual(parsed.departments[0]?.importedPeriods, ['10', '11', '12'])
  assert.equal(isMonthScopedWorkbook(parsed), true)
})

test('isMonthScopedWorkbook: false for a line-item/annual workbook with no month columns', () => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Line Item', 'Budget'],
    ['Cloud Hosting & Compute', 480000],
    ['Department Tools', 115000],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Engineering')
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Engineering', 'annual')

  assert.equal(isMonthScopedWorkbook(parsed), false)
})

test('isMonthScopedWorkbook: false when no departments parsed', () => {
  assert.equal(isMonthScopedWorkbook({ departments: [], departmentsMissing: [], invalidSheets: [] }), false)
})

test('parses multi-month sheets using the requested month column', () => {
  const workbook = XLSX.utils.book_new()
  const monthlySheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Jan', 'Feb', 'Mar'],
    ['', '', 'Cloud Hosting & Compute', 100, 150, 200],
    ['', '', 'Travel', 25, 30, 45],
  ])
  XLSX.utils.book_append_sheet(workbook, monthlySheet, 'Engineering')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Engineering', '02')

  assert.equal(parsed.departments[0]?.lines.hosting, 150)
  assert.equal(parsed.departments[0]?.lines.travel, 30)
  assert.deepEqual(parsed.departments[0]?.availablePeriods, ['01', '02', '03'])
  assert.deepEqual(parsed.departments[0]?.importedPeriods, ['02'])
  assert.deepEqual(parsed.departments[0]?.periods['02'], { hosting: 150, travel: 30 })
})

test('imports every detected month into canonical monthly periods when all months are selected', () => {
  const workbook = XLSX.utils.book_new()
  const monthlySheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Jan', 'Feb', 'Mar'],
    ['', '', 'Cloud Hosting & Compute', 100, 150, 200],
    ['', '', 'Travel', 25, 30, 45],
  ])
  XLSX.utils.book_append_sheet(workbook, monthlySheet, 'Engineering')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Engineering', 'annual')

  assert.deepEqual(parsed.departments[0]?.importedPeriods, ['01', '02', '03'])
  assert.deepEqual(parsed.departments[0]?.periods['01'], { hosting: 100, travel: 25 })
  assert.deepEqual(parsed.departments[0]?.periods['02'], { hosting: 150, travel: 30 })
  assert.deepEqual(parsed.departments[0]?.periods['03'], { hosting: 200, travel: 45 })
  assert.equal(parsed.departments[0]?.lines.hosting, 450)
  assert.equal(parsed.departments[0]?.lines.travel, 100)
})

test('uses fallback generic sheet names when importing a specific department workbook', () => {
  const workbook = XLSX.utils.book_new()
  const genericSheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Jan', 'Feb', 'Mar'],
    ['', '', 'Cloud Hosting & Compute', 100, 150, 200],
  ])
  XLSX.utils.book_append_sheet(workbook, genericSheet, 'BudgetByMonth')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Marketing', '03')

  assert.equal(parsed.departments[0]?.department, 'Marketing')
  assert.equal(parsed.departments[0]?.lines.hosting, 200)
})

test('matches fallback summary sheet names case-insensitively for department workbooks', () => {
  const workbook = XLSX.utils.book_new()
  const genericSheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Jan', 'Feb', 'Mar'],
    ['', '', 'Professional Services', 100, 200, 300],
  ])
  XLSX.utils.book_append_sheet(workbook, genericSheet, 'budgetbymonth')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Legal', '02')

  assert.equal(parsed.departments[0]?.department, 'Legal')
  assert.equal(parsed.departments[0]?.lines.profSvc, 200)
  assert.equal(parsed.invalidSheets.length, 0)
})

test('merges single-department workbooks that are split across category tabs', () => {
  const workbook = XLSX.utils.book_new()
  const compensationSheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Jan', 'Feb', 'Mar'],
    ['', 'Compensation & Benefits', '', '', ''],
    ['', '', 'Salaries & Wages', 16042, 16042, 16042],
    ['', '', 'Benefits', 1000, 1000, 1000],
  ])
  const professionalServicesSheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Jan', 'Feb', 'Mar'],
    ['', 'Professional Services', '', '', ''],
    ['', '', 'Professional Services', 4537, 4537, 4537],
    ['', '', 'Corporate Compliance', 0, 500, 500],
  ])
  const vendorsSheet = XLSX.utils.aoa_to_sheet([
    ['', '', '', 'Jan', 'Feb', 'Mar'],
    ['', '', 'Acme Legal Services', 99, 99, 99],
    ['', '', 'Another Vendor', 42, 42, 42],
  ])
  XLSX.utils.book_append_sheet(workbook, compensationSheet, 'Comp&Bene')
  XLSX.utils.book_append_sheet(workbook, professionalServicesSheet, 'ProfServices')
  XLSX.utils.book_append_sheet(workbook, vendorsSheet, 'Vendors')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Legal', '02')

  assert.equal(parsed.departments.length, 1)
  assert.equal(parsed.departments[0]?.department, 'Legal')
  assert.equal(parsed.departments[0]?.lines.salary, 16042)
  assert.equal(parsed.departments[0]?.lines.benefits, 1000)
  assert.equal(parsed.departments[0]?.lines.profSvc, 4537)
  assert.equal(parsed.departments[0]?.lines.corpCompliance, 500)
  assert.equal(parsed.invalidSheets.length, 0)
  assert.equal(parsed.departments[0]?.unmappedLineItems.includes('Acme Legal Services'), false)
})

test('rejects random workbook content that does not match the expected budget template', () => {
  const workbook = XLSX.utils.book_new()
  const randomSheet = XLSX.utils.aoa_to_sheet([
    ['foo', 'bar', 'baz', 'qux'],
    ['notes', 'more notes', 'totally unrelated', 123],
    ['another', 'row', 'random text', 456],
    ['tail', 'row', 'nothing useful', 789],
  ])
  XLSX.utils.book_append_sheet(workbook, randomSheet, 'Engineering')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Engineering')

  assert.equal(parsed.departments.length, 0)
  assert.equal(parsed.invalidSheets.length, 1)
  assert.match(parsed.invalidSheets[0]?.error || '', /expected budget template|recognized budget lines/i)
})

test('rejects audit-style exports that only coincidentally match fallback columns', () => {
  const workbook = XLSX.utils.book_new()
  const randomSheet = XLSX.utils.aoa_to_sheet([
    [],
    [],
    [],
    [],
    [],
    [],
    ['2026-01-01', 'Expense', 'Travel', 123, 'Mercury Bank'],
    ['2026-01-02', 'Expense', 'Office', 456, 'Vendor'],
    ['2026-01-03', 'Expense', 'Cloud Hosting & Compute', 789, 'AWS'],
  ])
  XLSX.utils.book_append_sheet(workbook, randomSheet, 'Engineering')

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const parsed = parseBudgetWorkbook(buffer, 'Engineering')

  assert.equal(parsed.departments.length, 0)
  assert.equal(parsed.invalidSheets.length, 1)
  assert.match(parsed.invalidSheets[0]?.error || '', /expected budget template|recognized budget lines/i)
})

test('merges imported period data into an existing department plan', () => {
  const merged = mergeDepartmentPeriod(
    {
      version: 1,
      year: 2026,
      department: 'Engineering',
      periods: { annual: { hosting: 1 } },
      source: 'sheet-import',
      importMeta: null,
    },
    {
      year: 2026,
      department: 'Engineering',
      period: '01',
      lines: { hosting: 2, travel: 3 },
      importMeta: {
        lastImportedAt: '2026-04-06T00:00:00.000Z',
        lastImportedBy: 'tester@orca.so',
        sourceFileName: 'engineering.xlsx',
        templateVersion: 'budget-v1-sheet',
      },
    },
  )

  assert.deepEqual(merged.periods, {
    annual: { hosting: 1 },
    '01': { hosting: 2, travel: 3 },
  })
  assert.equal(getBudgetDepartmentPlanPath(2026, 'Engineering'), 'budget/2026/plan/engineering.json')
})

test('clears a selected imported period without disturbing other periods', () => {
  const cleared = clearDepartmentPeriod(
    {
      version: 1,
      year: 2026,
      department: 'Engineering',
      periods: {
        annual: { hosting: 100 },
        '01': { hosting: 20 },
      },
      source: 'sheet-import',
      importMeta: null,
    },
    '01',
  )

  assert.deepEqual(cleared?.periods, {
    annual: { hosting: 100 },
  })
})

test('returns null when clearing the only imported period', () => {
  const cleared = clearDepartmentPeriod(
    {
      version: 1,
      year: 2026,
      department: 'Engineering',
      periods: {
        annual: { hosting: 100 },
      },
      source: 'sheet-import',
      importMeta: null,
    },
    'annual',
  )

  assert.equal(cleared, null)
})

test('clears multiple imported periods in one pass', () => {
  const cleared = clearDepartmentPeriods(
    {
      version: 1,
      year: 2026,
      department: 'Engineering',
      periods: {
        annual: { hosting: 100 },
        '01': { hosting: 20 },
        '02': { travel: 10 },
      },
      source: 'sheet-import',
      importMeta: null,
    },
    ['01', '02'],
  )

  assert.deepEqual(cleared?.periods, {
    annual: { hosting: 100 },
  })
})

test('diffs budget line amounts for preview mode', () => {
  const diff = diffBudgetLineAmounts(
    { hosting: 100, travel: 10 },
    { hosting: 120, epdTools: 15 },
  )

  assert.deepEqual(
    diff.map((entry) => ({
      key: entry.key,
      status: entry.status,
      beforeUsd: entry.beforeUsd,
      afterUsd: entry.afterUsd,
      deltaUsd: entry.deltaUsd,
    })),
    [
      { key: 'hosting', status: 'changed', beforeUsd: 100, afterUsd: 120, deltaUsd: 20 },
      { key: 'epdTools', status: 'added', beforeUsd: 0, afterUsd: 15, deltaUsd: 15 },
      { key: 'travel', status: 'removed', beforeUsd: 10, afterUsd: 0, deltaUsd: -10 },
    ],
  )
})

test('monthly workbook imports replace stale annual periods before merging', () => {
  const existingPlan: BudgetDepartmentPlan = {
    version: 1,
    year: 2026,
    department: 'Engineering',
    periods: {
      annual: { hosting: 1200 },
    },
    source: 'sheet-import' as const,
    importMeta: null,
  }

  const replacementPeriods = getBudgetImportExistingPeriodsToReplace(existingPlan, {
    layout: 'monthly-columns',
    importedPeriods: ['01', '02'],
  })
  const prepared = prepareDepartmentPlanForImport(existingPlan, {
    layout: 'monthly-columns',
    importedPeriods: ['01', '02'],
  })
  const merged = mergeDepartmentPeriods(prepared, {
    year: 2026,
    department: 'Engineering',
    periods: {
      '01': { hosting: 100 },
      '02': { hosting: 200 },
    },
    importMeta: {
      lastImportedAt: '2026-04-08T00:00:00.000Z',
      lastImportedBy: 'tester@orca.so',
      sourceFileName: 'budget.xlsx',
      templateVersion: 'budget-v1-sheet',
    },
  })

  assert.deepEqual(replacementPeriods, ['annual'])
  assert.equal(prepared, null)
  assert.deepEqual(merged?.periods, {
    '01': { hosting: 100 },
    '02': { hosting: 200 },
  })
})

test('Q4 month-scoped merge preserves Jan-Sep and clears the stale annual (recomputed on save)', () => {
  const existingPlan: BudgetDepartmentPlan = {
    version: 1,
    year: 2026,
    department: 'Engineering',
    periods: {
      '01': { hosting: 100 }, '02': { hosting: 100 }, '03': { hosting: 100 },
      '04': { hosting: 100 }, '05': { hosting: 100 }, '06': { hosting: 100 },
      '07': { hosting: 100 }, '08': { hosting: 100 }, '09': { hosting: 100 },
      '10': { hosting: 100 }, '11': { hosting: 100 }, '12': { hosting: 100 },
      annual: { hosting: 1200 },
    },
    source: 'sheet-import' as const,
    importMeta: null,
  }

  const prepared = prepareDepartmentPlanForImport(existingPlan, {
    layout: 'monthly-columns',
    importedPeriods: ['10', '11', '12'],
  })
  const merged = mergeDepartmentPeriods(prepared, {
    year: 2026,
    department: 'Engineering',
    periods: {
      '10': { hosting: 500 }, '11': { hosting: 500 }, '12': { hosting: 500 },
    },
    importMeta: {
      lastImportedAt: '2026-09-25T00:00:00.000Z',
      lastImportedBy: 'tester@orca.so',
      sourceFileName: 'q4.xlsx',
      templateVersion: 'budget-v1-sheet',
    },
  })

  // Jan-Sep untouched.
  for (const m of ['01', '02', '03', '04', '05', '06', '07', '08', '09']) {
    assert.deepEqual(merged?.periods[m as '01'], { hosting: 100 })
  }
  // Q4 replaced with the new numbers.
  assert.deepEqual(merged?.periods['10'], { hosting: 500 })
  assert.deepEqual(merged?.periods['11'], { hosting: 500 })
  assert.deepEqual(merged?.periods['12'], { hosting: 500 })
  // Stale annual removed here; saveBudgetDepartmentPlan recomputes it as the
  // sum of all twelve merged months (9*100 + 3*500 = 2400).
  assert.equal(merged?.periods.annual, undefined)
})

test('annual workbook imports replace stale monthly periods before merging', () => {
  const existingPlan: BudgetDepartmentPlan = {
    version: 1,
    year: 2026,
    department: 'Engineering',
    periods: {
      '01': { hosting: 100 },
      '02': { hosting: 200 },
    },
    source: 'sheet-import' as const,
    importMeta: null,
  }

  const replacementPeriods = getBudgetImportExistingPeriodsToReplace(existingPlan, {
    layout: 'header-annual',
    importedPeriods: ['annual'],
  })
  const prepared = prepareDepartmentPlanForImport(existingPlan, {
    layout: 'header-annual',
    importedPeriods: ['annual'],
  })
  const merged = mergeDepartmentPeriods(prepared, {
    year: 2026,
    department: 'Engineering',
    periods: {
      annual: { hosting: 3600 },
    },
    importMeta: {
      lastImportedAt: '2026-04-08T00:00:00.000Z',
      lastImportedBy: 'tester@orca.so',
      sourceFileName: 'budget.xlsx',
      templateVersion: 'budget-v1-sheet',
    },
  })

  assert.deepEqual(replacementPeriods, ['01', '02'])
  assert.equal(prepared, null)
  assert.deepEqual(merged?.periods, {
    annual: { hosting: 3600 },
  })
})
