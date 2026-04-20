import test from 'node:test'
import assert from 'node:assert/strict'

import { BUDGET_DEPTS } from '../constants.ts'
import { buildBudgetDepartmentReport, buildBudgetOverviewReport } from './reports.ts'
import { getBudgetPlanState } from './source.ts'
import {
  applyBudgetDepartmentActuals,
  applyBudgetOverviewActuals,
  composeBudgetActualLineSet,
  getBudgetOverviewActualDateRanges,
  mapQboAccountTotalsToBudgetLines,
  parseQboGeneralLedgerByClass,
  parseQboProfitAndLossReport,
} from './actuals.ts'
import type { BudgetDepartmentActualsState, BudgetOverviewActualsState, BudgetPlanState, BudgetViewState } from './types.ts'

const MONTH_VIEW: BudgetViewState = {
  year: 2026,
  entity: 'All',
  mode: 'month',
  month: 1,
  rangeStart: 0,
  rangeEnd: 1,
}

test('parses QBO Profit & Loss rows into account totals', () => {
  const parsed = parseQboProfitAndLossReport({
    Rows: {
      Row: [
        {
          type: 'Section',
          Rows: {
            Row: [
              {
                type: 'Data',
                ColData: [{ value: '60110 Employee Salaries' }, { value: '1200.50' }],
              },
              {
                type: 'Data',
                ColData: [{ value: '62040 Corporate Compliance' }, { value: '400' }],
              },
            ],
          },
        },
      ],
    },
  })

  assert.deepEqual(parsed, {
    '60110': 1200.5,
    '62040': 400,
  })
})

test('maps QBO accounts into canonical budget line totals', () => {
  const mapped = mapQboAccountTotalsToBudgetLines(
    {
      '60110': 1000,
      '60310': 500,
      '62040': 200,
    },
    [
      { cat: 'Compensation & Benefits', line: 'Salaries & Wages', key: 'salary', accounts: [60110, 60310] },
      { cat: 'Professional Services', line: 'Corporate Compliance', key: 'corpCompliance', accounts: [62040] },
    ],
  )

  assert.deepEqual(mapped, {
    salary: 1500,
    corpCompliance: 200,
  })
})

test('parses QBO General Ledger rows into classified and unclassified totals', () => {
  const parsed = parseQboGeneralLedgerByClass({
    Rows: {
      Row: [
        {
          type: 'Section',
          Rows: {
            Row: [
              {
                type: 'Data',
                ColData: [
                  { value: '2026-02-01' },
                  { value: 'Bill' },
                  { value: '123' },
                  { value: 'Vendor' },
                  { value: 'Engineering' },
                  { value: 'Memo' },
                  { value: '250' },
                  { value: '250' },
                ],
              },
              {
                type: 'Data',
                ColData: [
                  { value: '2026-02-01' },
                  { value: 'Bill' },
                  { value: '124' },
                  { value: 'Vendor' },
                  { value: '' },
                  { value: 'Memo' },
                  { value: '50' },
                  { value: '300' },
                ],
              },
            ],
          },
        },
      ],
    },
  })

  assert.deepEqual(parsed, {
    classified: { Engineering: 250 },
    unclassified: 50,
  })
})

test('applies actuals to overview report rows and computes variance', () => {
  const basePlan = getBudgetPlanState()
  const plan: BudgetPlanState = {
    ...basePlan,
    departments: Object.fromEntries(
      BUDGET_DEPTS.map((department) => [
        department,
        {
          ...basePlan.departments[department],
          periods: {
            annual: department === 'Engineering' ? { salary: 24000, corpCompliance: 2400 } : {},
          },
        },
      ]),
    ) as BudgetPlanState['departments'],
  }
  const report = buildBudgetOverviewReport(plan, BUDGET_DEPTS, MONTH_VIEW)
  const enriched = applyBudgetOverviewActuals(report, {
    source: 'quickbooks',
    year: 2026,
    view: MONTH_VIEW,
    fetchedAt: '2026-04-07T12:00:00.000Z',
    mappingSource: 'default-static',
    lines: {
      period: { salary: 1000, corpCompliance: 200 },
      ytd: { salary: 3000, corpCompliance: 500 },
      annual: { salary: 12000, corpCompliance: 1800, coreProductRevenue: 4200 },
    },
  } satisfies BudgetOverviewActualsState)

  const salaryRow = enriched.rows.find((row) => row.kind === 'line' && row.key === 'salary')
  const compTotal = enriched.rows.find((row) => row.kind === 'total' && row.category === 'Compensation & Benefits')
  const revenueRow = enriched.rows.find((row) => row.kind === 'line' && row.key === 'coreProductRevenue')

  assert.equal(enriched.actualsStatus, 'live')
  assert.equal(salaryRow?.cells.period.actualUsd, 1000)
  assert.equal(
    salaryRow?.cells.period.varianceUsd,
    1000 - (salaryRow?.cells.period.budgetUsd ?? 0),
  )
  assert.equal(compTotal?.cells.annual.actualUsd, 12000)
  assert.equal(revenueRow?.cells.annual.actualUsd, 4200)
  assert.equal(revenueRow?.cells.annual.varianceUsd, null)
})

test('applies department actuals to the fixed department report rows', () => {
  const basePlan = getBudgetPlanState()
  const plan: BudgetPlanState = {
    ...basePlan,
    departments: {
      ...basePlan.departments,
      Engineering: {
        ...basePlan.departments.Engineering,
        periods: {
          annual: { salary: 24000, bonus: 2400, contingency: 1200 },
        },
      },
    },
  }

  const departmentReport = buildBudgetDepartmentReport(plan, 'Engineering', MONTH_VIEW)

  const enriched = applyBudgetDepartmentActuals(departmentReport, {
    source: 'quickbooks',
    year: 2026,
    view: MONTH_VIEW,
    department: 'Engineering',
    fetchedAt: '2026-04-08T02:00:00.000Z',
    mappingSource: 'default-static',
    lines: {
      period: { salary: 1000, bonus: 250, coreProductRevenue: 400 },
      ytd: { salary: 3000, bonus: 500, coreProductRevenue: 900 },
      annual: { salary: 12000, bonus: 1200, coreProductRevenue: 5400 },
    },
    unclassifiedLines: {
      period: { salary: 100 },
      ytd: { salary: 200 },
      annual: { salary: 400 },
    },
  } satisfies BudgetDepartmentActualsState)

  const salaryRow = enriched.rows.find((row) => row.kind === 'line' && row.key === 'salary')
  const totalIcRow = enriched.rows.find((row) => row.kind === 'total' && row.label === 'Total IC')
  const contingencyRow = enriched.rows.find((row) => row.kind === 'line' && row.key === 'contingency')
  const revenueRow = enriched.rows.find((row) => row.kind === 'line' && row.key === 'coreProductRevenue')

  assert.equal(salaryRow?.cells.period.actualUsd, 1000)
  assert.equal(totalIcRow?.cells.annual.actualUsd, 1200)
  assert.equal(contingencyRow?.cells.period.actualUsd, null)
  assert.equal(revenueRow?.cells.annual.actualUsd, 5400)
})

test('builds period, ytd, and annual ranges for overview actual fetches', () => {
  const ranges = getBudgetOverviewActualDateRanges(MONTH_VIEW)

  assert.deepEqual(ranges, {
    period: { start: '2026-02-01', end: '2026-02-28' },
    ytd: { start: '2026-01-01', end: '2026-02-28' },
    annual: { start: '2026-01-01', end: '2026-12-31' },
  })
})

test('composes actual line sets without collapsing annual totals into ytd', () => {
  const merged = composeBudgetActualLineSet(
    {
      period: { salary: 1000 },
      ytd: { salary: 3000 },
      annual: { salary: 12000 },
    },
    {
      period: { coreProductRevenue: 400 },
      ytd: { coreProductRevenue: 900 },
      annual: { coreProductRevenue: 5400 },
    },
  )

  assert.deepEqual(merged, {
    period: { salary: 1000, coreProductRevenue: 400 },
    ytd: { salary: 3000, coreProductRevenue: 900 },
    annual: { salary: 12000, coreProductRevenue: 5400 },
  })
})
