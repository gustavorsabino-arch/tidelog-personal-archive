import {
  getBudgetScopeMonthIndices,
  getBudgetScopeYtdMonthIndices,
  monthIndexToPeriodKey,
} from './scope.ts'
import type {
  BudgetDepartmentActualsState,
  BudgetActualLineSet,
  BudgetLineAmounts,
  BudgetOverviewActualsState,
  BudgetQbMappingRow,
  BudgetReportCell,
  BudgetReportRow,
  BudgetReportTableModel,
  BudgetViewState,
} from './types.ts'

export type QboProfitAndLossAccountTotals = Record<string, number>

export type QboReportRow = {
  type?: string
  ColData?: Array<{ value?: string; id?: string }>
  Rows?: { Row?: QboReportRow[] }
}

export type QboProfitAndLossReport = {
  Rows?: { Row?: QboReportRow[] }
}

export type QboGeneralLedgerReport = {
  Rows?: { Row?: QboReportRow[] }
}

export type QboGeneralLedgerByClassTotals = {
  classified: Record<string, number>
  unclassified: number
}

function buildBudgetReportCell(budgetUsd: number | null, actualUsd: number): BudgetReportCell {
  return {
    budgetUsd,
    actualUsd,
    varianceUsd: budgetUsd === null ? null : actualUsd - budgetUsd,
  }
}

export function parseQboProfitAndLossReport(report: QboProfitAndLossReport): QboProfitAndLossAccountTotals {
  const result: QboProfitAndLossAccountTotals = {}

  function walk(rows: QboReportRow[] | undefined) {
    if (!rows) return

    for (const row of rows) {
      if (row.type === 'Data' && row.ColData) {
        const accountLabel = row.ColData[0]?.value || ''
        const amount = Number.parseFloat(row.ColData[1]?.value || '0') || 0
        const match = accountLabel.match(/^(\d{4,6})\s/)
        if (match && amount !== 0) {
          result[match[1]] = (result[match[1]] ?? 0) + amount
        }
      }

      if (row.Rows?.Row) {
        walk(row.Rows.Row)
      }
    }
  }

  walk(report?.Rows?.Row)
  return result
}

export function parseQboGeneralLedgerByClass(report: QboGeneralLedgerReport): QboGeneralLedgerByClassTotals {
  const classified: Record<string, number> = {}
  let unclassified = 0

  function walk(rows: QboReportRow[] | undefined) {
    if (!rows) return

    for (const row of rows) {
      if (row.type === 'Data' && row.ColData) {
        const columns = row.ColData
        const className = columns[4]?.value?.trim() ?? ''
        const amount = Number.parseFloat(columns[6]?.value || '0') || 0

        if (amount !== 0) {
          if (className) {
            classified[className] = (classified[className] ?? 0) + amount
          } else {
            unclassified += amount
          }
        }
      }

      if (row.Rows?.Row) {
        walk(row.Rows.Row)
      }
    }
  }

  walk(report?.Rows?.Row)
  return { classified, unclassified }
}

export function mapQboAccountTotalsToBudgetLines(
  accountTotals: QboProfitAndLossAccountTotals,
  mappingRows: readonly BudgetQbMappingRow[],
): BudgetLineAmounts {
  const result: BudgetLineAmounts = {}

  for (const row of mappingRows) {
    const key = String(row.key)
    const total = row.accounts.reduce((sum, account) => sum + (accountTotals[String(account)] ?? 0), 0)
    result[key] = total
  }

  return result
}

export function cloneBudgetLineAmounts(lines: BudgetLineAmounts): BudgetLineAmounts {
  return Object.fromEntries(Object.entries(lines)) as BudgetLineAmounts
}

export function addBudgetLineAmounts(target: BudgetLineAmounts, source: BudgetLineAmounts) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (value ?? 0)
  }
}

export function composeBudgetActualLineSet(
  base: BudgetActualLineSet,
  extra: BudgetActualLineSet | null = null,
): BudgetActualLineSet {
  const next: BudgetActualLineSet = {
    period: cloneBudgetLineAmounts(base.period),
    ytd: cloneBudgetLineAmounts(base.ytd),
    annual: cloneBudgetLineAmounts(base.annual),
  }

  if (!extra) return next

  addBudgetLineAmounts(next.period, extra.period)
  addBudgetLineAmounts(next.ytd, extra.ytd)
  addBudgetLineAmounts(next.annual, extra.annual)

  return next
}

function applyActualsToRow(
  row: BudgetReportRow,
  actuals: BudgetActualLineSet,
  keys: readonly string[],
): BudgetReportRow {
  const periodActual = keys.reduce((sum, key) => sum + (actuals.period[key] ?? 0), 0)
  const ytdActual = keys.reduce((sum, key) => sum + (actuals.ytd[key] ?? 0), 0)
  const annualActual = keys.reduce((sum, key) => sum + (actuals.annual[key] ?? 0), 0)

  return {
    ...row,
    cells: {
      period: buildBudgetReportCell(row.cells.period.budgetUsd, periodActual),
      ytd: buildBudgetReportCell(row.cells.ytd.budgetUsd, ytdActual),
      annual: buildBudgetReportCell(row.cells.annual.budgetUsd, annualActual),
    },
  }
}

export function applyBudgetOverviewActuals(
  report: BudgetReportTableModel,
  actuals: BudgetOverviewActualsState,
): BudgetReportTableModel {
  return {
    ...report,
    actualsStatus: 'live',
    rows: report.rows.map((row) => {
      if (row.kind === 'category') {
        return row
      }

      if (row.actualKeys === null) {
        return row
      }

      const actualKeys = row.actualKeys ?? [row.key]
      return applyActualsToRow(row, actuals.lines, actualKeys)
    }),
  }
}

export function applyBudgetDepartmentActuals(
  report: BudgetReportTableModel,
  actuals: BudgetDepartmentActualsState,
): BudgetReportTableModel {
  return {
    ...report,
    actualsStatus: 'live',
    rows: report.rows.map((row) => {
      if (row.kind === 'category') {
        return row
      }

      if (row.actualKeys === null) {
        return row
      }

      const actualKeys = row.actualKeys ?? [row.key]
      return applyActualsToRow(row, actuals.lines, actualKeys)
    }),
  }
}

function getRangeStartAndEnd(year: number, months: number[]) {
  const startMonth = Math.min(...months)
  const endMonth = Math.max(...months)
  const start = `${year}-${monthIndexToPeriodKey(startMonth)}-01`
  const end = `${year}-${monthIndexToPeriodKey(endMonth)}-${new Date(year, endMonth + 1, 0).getDate()}`
  return { start, end }
}

export function getBudgetOverviewActualDateRanges(view: BudgetViewState): {
  period: { start: string; end: string }
  ytd: { start: string; end: string }
  annual: { start: string; end: string }
} {
  const periodMonths = getBudgetScopeMonthIndices(view)
  const ytdMonths = getBudgetScopeYtdMonthIndices(view)
  const annualMonths = Array.from({ length: 12 }, (_, index) => index)

  return {
    period: getRangeStartAndEnd(view.year, periodMonths),
    ytd: getRangeStartAndEnd(view.year, ytdMonths),
    annual: getRangeStartAndEnd(view.year, annualMonths),
  }
}
