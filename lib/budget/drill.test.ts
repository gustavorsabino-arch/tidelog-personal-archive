import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canOpenBudgetActualDrill,
  canOpenBudgetPlanBreakdown,
  getBudgetActualDrillTitle,
  getBudgetPlanBreakdownSubtitle,
} from './drill.ts'
import type { BudgetReportRow, BudgetReportTableModel, BudgetViewState } from './types.ts'

const VIEW: BudgetViewState = {
  year: 2026,
  entity: 'All',
  mode: 'month',
  month: 1,
  rangeStart: 0,
  rangeEnd: 1,
}

function makeLineRow(): BudgetReportRow {
  return {
    kind: 'line',
    key: 'salary',
    label: 'Salaries & Wages',
    category: 'Compensation & Benefits',
    budgetKeys: ['salary'],
    actualKeys: ['salary'],
    cells: {
      period: { budgetUsd: 100, actualUsd: 90, varianceUsd: -10 },
      ytd: { budgetUsd: 200, actualUsd: 180, varianceUsd: -20 },
      annual: { budgetUsd: 1200, actualUsd: 180, varianceUsd: -1020 },
    },
  }
}

const LIVE_OVERVIEW_REPORT: Pick<BudgetReportTableModel, 'actualsStatus' | 'actualDrillOpenMode'> = {
  actualsStatus: 'live',
  actualDrillOpenMode: 'positive-only',
}

const LIVE_DEPARTMENT_REPORT: Pick<BudgetReportTableModel, 'actualsStatus' | 'actualDrillOpenMode'> = {
  actualsStatus: 'live',
  actualDrillOpenMode: 'non-zero',
}

test('matches v1 drill clickability for budget and actual report cells', () => {
  const row = makeLineRow()

  assert.equal(canOpenBudgetPlanBreakdown(row, 'period'), true)
  assert.equal(canOpenBudgetPlanBreakdown(row, 'ytd'), false)
  assert.equal(canOpenBudgetPlanBreakdown(row, 'annual'), false)

  assert.equal(canOpenBudgetActualDrill(row, 'period', LIVE_OVERVIEW_REPORT), true)
  assert.equal(canOpenBudgetActualDrill(row, 'ytd', LIVE_OVERVIEW_REPORT), true)
  assert.equal(canOpenBudgetActualDrill(row, 'annual', LIVE_OVERVIEW_REPORT), false)
})

test('allows negative actual drills for department parity while keeping overview positive-only', () => {
  const row = makeLineRow()
  row.cells.period.actualUsd = -90
  row.cells.ytd.actualUsd = -180

  assert.equal(canOpenBudgetActualDrill(row, 'period', LIVE_OVERVIEW_REPORT), false)
  assert.equal(canOpenBudgetActualDrill(row, 'period', LIVE_DEPARTMENT_REPORT), true)
  assert.equal(canOpenBudgetActualDrill(row, 'ytd', LIVE_DEPARTMENT_REPORT), true)
})

test('formats parity drill subtitles and actual drill titles', () => {
  assert.equal(getBudgetPlanBreakdownSubtitle(VIEW, 'period'), 'Budget breakdown by department · Feb 2026')
  assert.equal(getBudgetActualDrillTitle('Salaries & Wages', VIEW, 'period', ['salary']), 'Salaries & Wages · 2026-02')
  assert.equal(getBudgetActualDrillTitle('Salaries & Wages', VIEW, 'ytd', ['salary']), 'Salaries & Wages · YTD 2026-01 → 2026-02')
})
