import test from 'node:test'
import assert from 'node:assert/strict'

import { BUDGET_DEPTS } from '../constants.ts'
import { getBudgetPlanState } from './source.ts'
import { buildBudgetDepartmentReport, buildBudgetOverviewReport, buildBudgetPlanBreakdown, getBudgetDepartmentPlanCoverage } from './reports.ts'
import type { AdjustmentRecord } from './adjustments.ts'
import type { BudgetPlanState, BudgetViewState } from './types.ts'

const MONTH_VIEW: BudgetViewState = {
  year: 2026,
  entity: 'All',
  mode: 'month',
  month: 1,
  rangeStart: 0,
  rangeEnd: 1,
}

const JAN_VIEW: BudgetViewState = {
  ...MONTH_VIEW,
  month: 0,
  rangeStart: 0,
  rangeEnd: 0,
}

test('builds overview report with the fixed v1 row layout', () => {
  const plan = getBudgetPlanState()
  const report = buildBudgetOverviewReport(plan, BUDGET_DEPTS, MONTH_VIEW)

  assert.equal(report.actualsStatus, 'placeholder')
  assert.equal(report.title, 'Spend by Category — All Departments')
  assert.equal(report.helperText, 'Click budget value to see dept breakdown')
  assert.deepEqual(
    report.rows.slice(0, 4).map((row) => [row.kind, row.label]),
    [
      ['category', 'Revenue'],
      ['line', 'Core Product Revenue'],
      ['category', 'Compensation & Benefits'],
      ['line', 'Salaries & Wages'],
    ],
  )
  assert.ok(report.rows.some((row) => row.kind === 'category' && row.label === 'Incentive Compensation'))
  assert.ok(report.rows.some((row) => row.kind === 'line' && row.label === 'Bonus'))
  assert.ok(report.rows.some((row) => row.kind === 'line' && row.label === 'Commissions'))
  assert.ok(report.rows.some((row) => row.kind === 'category' && row.label === 'Contingency'))
  assert.ok(report.rows.some((row) => row.kind === 'total' && row.label === 'Total Expenses ex-IC'))
  assert.ok(report.rows.some((row) => row.kind === 'total' && row.label === 'Total IC'))
  assert.ok(report.rows.some((row) => row.kind === 'total' && row.label === 'Total Expenses'))
  assert.ok(report.rows.some((row) => row.kind === 'line' && row.key === 'commissions'))
  assert.deepEqual(report.rows.find((row) => row.key === 'salary')?.budgetKeys, ['salary'])
  assert.deepEqual(report.rows.find((row) => row.key === 'total:expenses')?.budgetKeys, [
    'salary',
    'benefits',
    'payroll',
    'severance',
    'epdTools',
    'bizTools',
    'hosting',
    'blockchainRpc',
    'securityMon',
    'hrCosts',
    'recruiting',
    'meals',
    'mktExp',
    'profSvc',
    'corpCompliance',
    'industryRelations',
    'travel',
    'colos',
    'bankFees',
    'rent',
    'hardware',
    'bonus',
    'commissions',
    'contingency',
  ])
})

test('uses monthly imported data when available and annual fallback otherwise', () => {
  const plan = getBudgetPlanState()
  const monthlyPlan: BudgetPlanState = {
    ...plan,
    departments: {
      ...plan.departments,
      Engineering: {
        ...plan.departments.Engineering,
        periods: {
          '01': { hosting: 10 },
          '02': { hosting: 20 },
        },
      },
    },
  }

  const report = buildBudgetDepartmentReport(monthlyPlan, 'Engineering', MONTH_VIEW)
  const hostingRow = report.rows.find((row) => row.kind === 'line' && row.key === 'hosting')

  assert.equal(report.title, 'Engineering')
  assert.equal(report.subtitle, 'Department detail · Feb YTD')
  assert.ok(hostingRow)
  assert.equal(hostingRow?.cells.period.budgetUsd, 20)
  assert.equal(hostingRow?.cells.ytd.budgetUsd, 30)
  assert.equal(hostingRow?.cells.annual.budgetUsd, 30)
  assert.equal(report.rows.find((row) => row.key === 'coreProductRevenue')?.cells.period.budgetUsd, null)
  assert.equal(report.rows.find((row) => row.key === 'contingency')?.cells.period.actualUsd, null)
})

test('does not mix placeholder budget scaffolding into a year with imported plan files', () => {
  const placeholder = getBudgetPlanState()
  const plan: BudgetPlanState = {
    ...placeholder,
    source: 'sheet-import',
    departments: {
      ...placeholder.departments,
      Engineering: {
        ...placeholder.departments.Engineering,
        source: 'sheet-import',
        periods: {
          '01': { hosting: 10 },
        },
      },
    },
  }

  const report = buildBudgetOverviewReport(plan, BUDGET_DEPTS, JAN_VIEW)
  const hostingRow = report.rows.find((row) => row.kind === 'line' && row.key === 'hosting')
  const travelRow = report.rows.find((row) => row.kind === 'line' && row.key === 'travel')

  assert.equal(hostingRow?.cells.period.budgetUsd, 10)
  assert.equal(travelRow?.cells.period.budgetUsd, null)
})

test('preserves negative budget values in overview and department reports', () => {
  const basePlan = getBudgetPlanState()
  const plan: BudgetPlanState = {
    ...basePlan,
    departments: {
      ...basePlan.departments,
      Engineering: {
        ...basePlan.departments.Engineering,
        periods: {
          annual: { bonus: -1200 },
          '01': { bonus: -100 },
        },
      },
    },
  }

  const overviewReport = buildBudgetOverviewReport(plan, BUDGET_DEPTS, JAN_VIEW)
  const departmentReport = buildBudgetDepartmentReport(plan, 'Engineering', JAN_VIEW)

  assert.equal(overviewReport.rows.find((row) => row.key === 'bonus')?.cells.period.budgetUsd, -100)
  assert.equal(overviewReport.rows.find((row) => row.key === 'bonus')?.cells.annual.budgetUsd, -1200)
  assert.equal(departmentReport.rows.find((row) => row.key === 'bonus')?.cells.period.budgetUsd, -100)
  assert.equal(departmentReport.rows.find((row) => row.key === 'bonus')?.cells.annual.budgetUsd, -1200)
})

test('builds an unclassified department report without planned budget values', () => {
  const plan = getBudgetPlanState()
  const report = buildBudgetDepartmentReport(plan, 'Not specified', MONTH_VIEW)

  const salaryRow = report.rows.find((row) => row.kind === 'line' && row.key === 'salary')

  assert.equal(report.title, 'Not specified')
  assert.equal(report.subtitle, 'Department detail · Feb YTD')
  assert.equal(salaryRow?.cells.period.budgetUsd, null)
  assert.equal(salaryRow?.cells.ytd.budgetUsd, null)
  assert.equal(salaryRow?.cells.annual.budgetUsd, null)
})

test('builds a department budget breakdown for the selected report row and column', () => {
  const basePlan = getBudgetPlanState()
  const plan: BudgetPlanState = {
    ...basePlan,
    departments: {
      ...basePlan.departments,
      Engineering: {
        ...basePlan.departments.Engineering,
        periods: { annual: { salary: 24000 } },
      },
      Marketing: {
        ...basePlan.departments.Marketing,
        periods: { annual: { salary: 12000 } },
      },
    },
  }
  const report = buildBudgetOverviewReport(plan, BUDGET_DEPTS, JAN_VIEW)
  const salaryRow = report.rows.find((row) => row.key === 'salary')

  assert.ok(salaryRow)

  const breakdown = buildBudgetPlanBreakdown(plan, ['Engineering', 'Marketing'], JAN_VIEW, salaryRow, 'annual')

  assert.equal(breakdown.rowKey, 'salary')
  assert.equal(breakdown.entries.length, 2)
  assert.equal(breakdown.entries[0]?.department, 'Engineering')
  assert.equal(breakdown.entries[0]?.amountUsd, 24000)
  assert.equal(breakdown.entries[1]?.department, 'Marketing')
  assert.equal(breakdown.entries[1]?.amountUsd, 12000)
  assert.equal(Number(breakdown.entries.reduce((sum, entry) => sum + entry.pctOfTotal, 0).toFixed(4)), 1)
})

test('builds period budget breakdown entries from imported monthly plan data', () => {
  const basePlan = getBudgetPlanState()
  const plan: BudgetPlanState = {
    ...basePlan,
    departments: {
      ...basePlan.departments,
      Engineering: {
        ...basePlan.departments.Engineering,
        periods: { '01': { salary: 100 } },
      },
      Marketing: {
        ...basePlan.departments.Marketing,
        periods: { '01': { salary: 50 } },
      },
    },
  }
  const report = buildBudgetOverviewReport(plan, BUDGET_DEPTS, JAN_VIEW)
  const salaryRow = report.rows.find((row) => row.key === 'salary')

  assert.ok(salaryRow)

  const breakdown = buildBudgetPlanBreakdown(plan, ['Engineering', 'Marketing'], JAN_VIEW, salaryRow, 'period')

  assert.equal(breakdown.totalUsd, 150)
  assert.deepEqual(
    breakdown.entries.map((entry) => [entry.department, entry.amountUsd]),
    [
      ['Engineering', 100],
      ['Marketing', 50],
    ],
  )
})

test('computes plan coverage for the selected months', () => {
  const plan = getBudgetPlanState()
  const coverage = getBudgetDepartmentPlanCoverage(plan, ['Engineering'], [0, 1])
  assert.equal(coverage, 0)
})

test('overlays a December adjustment onto annual budget only (not January) and sets adjustmentUsd', () => {
  const plan = getBudgetPlanState()
  const adjustments: AdjustmentRecord[] = [{
    department: 'Engineering', lineItem: 'bizTools', kind: 'one_time',
    amount: 10000, startPeriod: '12', durationMonths: 1, status: 'active',
  }]
  const base = buildBudgetOverviewReport(plan, BUDGET_DEPTS, JAN_VIEW)
  const withAdj = buildBudgetOverviewReport(plan, BUDGET_DEPTS, JAN_VIEW, adjustments)

  const baseRow = base.rows.find((r) => r.key === 'bizTools')!
  const row = withAdj.rows.find((r) => r.key === 'bizTools')!

  assert.equal(row.cells.period.budgetUsd ?? 0, baseRow.cells.period.budgetUsd ?? 0)
  assert.equal(row.cells.ytd.budgetUsd ?? 0, baseRow.cells.ytd.budgetUsd ?? 0)
  assert.equal((row.cells.annual.budgetUsd ?? 0) - (baseRow.cells.annual.budgetUsd ?? 0), 10000)
  assert.equal(row.adjustmentUsd, 10000)
  assert.deepEqual(row.adjustmentByDepartment, [{ department: 'Engineering', amountUsd: 10000 }])
})

test('reversed adjustments do not affect the report', () => {
  const plan = getBudgetPlanState()
  const adjustments: AdjustmentRecord[] = [{
    department: 'Engineering', lineItem: 'bizTools', kind: 'one_time',
    amount: 10000, startPeriod: '12', durationMonths: 1, status: 'reversed',
  }]
  const base = buildBudgetOverviewReport(plan, BUDGET_DEPTS, JAN_VIEW)
  const withAdj = buildBudgetOverviewReport(plan, BUDGET_DEPTS, JAN_VIEW, adjustments)
  const baseRow = base.rows.find((r) => r.key === 'bizTools')!
  const row = withAdj.rows.find((r) => r.key === 'bizTools')!
  assert.equal(row.cells.annual.budgetUsd ?? 0, baseRow.cells.annual.budgetUsd ?? 0)
  assert.equal(row.adjustmentUsd ?? 0, 0)
})
