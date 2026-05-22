import {
  getBudgetScopeMonthIndices,
  getBudgetScopeYtdMonthIndices,
  monthIndexToPeriodKey,
} from './scope.ts'
import {
  parseQboGeneralLedgerRows,
  type ParsedQboGeneralLedgerRow,
} from './qb-general-ledger.ts'
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
  Columns?: {
    Column?: Array<{
      ColTitle?: string
      ColType?: string
      MetaData?: Array<{ Name?: string; Value?: string }>
    }>
  }
  Rows?: { Row?: QboReportRow[] }
}

type QboReportRowLike = {
  type?: string
  Header?: { ColData?: Array<{ value?: string }> }
  ColData?: Array<{ value?: string; id?: string }>
  Rows?: { Row?: QboReportRowLike[] }
  Summary?: unknown
}

/**
 * QB's GL report with multiple `accounts=` returns one section per account,
 * each section having a Header row whose first ColData starts with the
 * account number (e.g. "60110 Salaries & Wages", or "1130000 Digital
 * Assets" — QB account numbers run from 4 digits up to 8+). Split back
 * into one per-account sub-report so the existing per-account parsers
 * still apply.
 */
export function splitGeneralLedgerByAccount(
  report: QboGeneralLedgerReport,
): Map<string, QboGeneralLedgerReport> {
  const out = new Map<string, QboGeneralLedgerReport>()
  const sections = (report?.Rows?.Row ?? []) as QboReportRowLike[]
  for (const section of sections) {
    const headerValue = section.Header?.ColData?.[0]?.value ?? ''
    const match = headerValue.match(/^(\d+)(?:\s|$)/)
    if (!match) continue
    const accountNumber = match[1]
    const perAccount: QboGeneralLedgerReport = {
      Rows: section.Rows ?? { Row: [] },
    }
    out.set(accountNumber, perAccount)
  }
  return out
}

/**
 * Merge multiple monthly per-account GL reports into one synthetic GL report
 * whose top-level Data rows are the concatenation of every input's rows.
 * Used by multi-month YTD / annual drills.
 */
export function mergeGeneralLedgerReports(
  reports: readonly QboGeneralLedgerReport[],
): QboGeneralLedgerReport {
  // Preserve `Columns` from the first non-empty report. All reports for the
  // same realm/account share the same column structure, so taking the first
  // one is correct. Without this, the metadata-driven parser
  // (`parseQboGeneralLedgerRows`) can't identify any field by ColKey and
  // returns zero rows.
  const columns = reports.find((r) => r?.Columns?.Column?.length)?.Columns
  const rows: QboReportRow[] = []
  for (const report of reports) {
    for (const row of report?.Rows?.Row ?? []) rows.push(row)
  }
  return columns ? { Columns: columns, Rows: { Row: rows } } : { Rows: { Row: rows } }
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
          // Match v1 behavior: overwrite on duplicate-account rows rather
          // than accumulate. QB occasionally emits the same account twice
          // with the same total (e.g. nested subtotals echoing a leaf row);
          // accumulating double-counted those lines.
          result[match[1]] = amount
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

/**
 * Pure bucket aggregator. Splits a list of already-parsed (and optionally
 * enriched) GL rows into classified totals + an unclassified bucket. Pulled
 * out so the enrichment path in qb-headcount-actuals.ts can reuse the same
 * accounting after enrichGlRowsWithClass fills in the class column.
 */
export function aggregateGeneralLedgerRowsByClass(
  rows: readonly ParsedQboGeneralLedgerRow[],
): QboGeneralLedgerByClassTotals {
  const classified: Record<string, number> = {}
  let unclassified = 0

  for (const row of rows) {
    const amount = row.amountUsd ?? 0
    if (amount === 0) continue
    if (row.className) {
      classified[row.className] = (classified[row.className] ?? 0) + amount
    } else {
      unclassified += amount
    }
  }

  return { classified, unclassified }
}

export function parseQboGeneralLedgerByClass(report: QboGeneralLedgerReport): QboGeneralLedgerByClassTotals {
  // Delegate to the metadata-driven parser so we don't duplicate column-
  // position assumptions across two functions. The shape of QB's GL response
  // varies by realm (multi-currency, class tracking, etc.); the underlying
  // `parseQboGeneralLedgerRows` looks up each field by ColKey rather than by
  // hardcoded index, so both this aggregation and the drill-down drawer see
  // a consistent interpretation.
  return aggregateGeneralLedgerRowsByClass(parseQboGeneralLedgerRows(report))
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

  // v1 parity: the "Full Year" column's ACTUAL is always the YTD actual,
  // not a Jan 1–Dec 31 fetch. See index.html:14467 ("aFullYearOv = aYTD").
  // Only the budget side of that column uses the full-year sum.
  return {
    period: getRangeStartAndEnd(view.year, periodMonths),
    ytd: getRangeStartAndEnd(view.year, ytdMonths),
    annual: getRangeStartAndEnd(view.year, ytdMonths),
  }
}
