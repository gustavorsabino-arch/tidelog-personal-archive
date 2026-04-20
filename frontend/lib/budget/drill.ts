import { getBudgetOverviewActualDateRanges } from './actuals.ts'
import { monthIndexToShortLabel } from './scope.ts'
import type {
  BudgetReportColumnKey,
  BudgetReportRow,
  BudgetReportTableModel,
  BudgetViewState,
} from './types.ts'

const REVENUE_KEY = 'coreProductRevenue'

export type BudgetActualDrillRange = {
  start: string
  end: string
}

export function canOpenBudgetPlanBreakdown(
  row: BudgetReportRow,
  column: BudgetReportColumnKey,
): boolean {
  return row.kind === 'line' && column === 'period' && row.budgetKeys !== null && row.cells.period.budgetUsd !== null
}

export function canOpenBudgetActualDrill(
  row: BudgetReportRow,
  column: BudgetReportColumnKey,
  report: Pick<BudgetReportTableModel, 'actualsStatus' | 'actualDrillOpenMode'>,
): boolean {
  const actualUsd = row.cells[column].actualUsd ?? 0
  const hasDrillableActual = report.actualDrillOpenMode === 'non-zero'
    ? actualUsd !== 0
    : actualUsd > 0

  return row.kind === 'line'
    && (column === 'period' || column === 'ytd')
    && row.actualKeys !== null
    && report.actualsStatus === 'live'
    && hasDrillableActual
}

export function getBudgetPlanBreakdownSubtitle(
  view: BudgetViewState,
  column: BudgetReportColumnKey,
): string {
  const label = column === 'period'
    ? (view.mode === 'ytd'
      ? `YTD ${view.year}`
      : view.mode === 'month'
        ? `${monthIndexToShortLabel(view.month)} ${view.year}`
        : `${monthIndexToShortLabel(Math.min(view.rangeStart, view.rangeEnd))}-${monthIndexToShortLabel(Math.max(view.rangeStart, view.rangeEnd))} ${view.year}`)
    : column === 'ytd'
      ? `${monthIndexToShortLabel(view.month)} YTD`
      : String(view.year)

  return `Budget breakdown by department · ${label}`
}

export function getBudgetActualDrillRange(
  view: BudgetViewState,
  column: BudgetReportColumnKey,
  lineKeys: readonly string[],
): BudgetActualDrillRange {
  const ranges = getBudgetOverviewActualDateRanges(view)
  if (column === 'period') return ranges.period
  if (column === 'ytd') return ranges.ytd

  return lineKeys.includes(REVENUE_KEY) ? ranges.annual : ranges.ytd
}

function formatRangeMonth(value: string): string {
  return value.slice(0, 7)
}

export function getBudgetActualDrillTitle(
  rowLabel: string,
  view: BudgetViewState,
  column: BudgetReportColumnKey,
  lineKeys: readonly string[],
): string {
  const range = getBudgetActualDrillRange(view, column, lineKeys)
  const startMonth = formatRangeMonth(range.start)
  const endMonth = formatRangeMonth(range.end)

  if (column === 'ytd') {
    return `${rowLabel} · YTD ${startMonth}${startMonth !== endMonth ? ` → ${endMonth}` : ''}`
  }

  return `${rowLabel} · ${startMonth}${startMonth !== endMonth ? ` → ${endMonth}` : ''}`
}
