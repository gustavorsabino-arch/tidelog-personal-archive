// Pure overlay logic for budget adjustments. No DB, no I/O.
//
// An adjustment is a signed amount attached to (department, lineItem) that
// applies to one month (one_time) or a run of months (recurring). The budget
// report folds these per-month net deltas onto the plan's budget cells.

import type { BudgetMonthKey, BudgetReportColumnKey } from './types.ts'

export type AdjustmentRecord = {
  department: string
  lineItem: string
  kind: 'one_time' | 'recurring'
  amount: number
  startPeriod: BudgetMonthKey
  durationMonths: number
  status: 'active' | 'reversed'
}

export const ALL_BUDGET_MONTHS: BudgetMonthKey[] = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
]

// The months an adjustment applies to. one_time → [start]; recurring →
// [start .. start+duration-1], clamped to December (never spills into next year).
export function coveredMonths(a: AdjustmentRecord): BudgetMonthKey[] {
  const startIdx = ALL_BUDGET_MONTHS.indexOf(a.startPeriod)
  if (startIdx < 0) return []
  const span = a.kind === 'recurring' ? Math.max(1, a.durationMonths) : 1
  return ALL_BUDGET_MONTHS.slice(startIdx, startIdx + span)
}

// Net signed delta per month for one line item, summing every ACTIVE adjustment
// that covers that month. With no `department` filter it aggregates across all
// departments (the All-Departments view); with one it scopes to that department.
export function netAdjustmentByMonth(
  adjustments: AdjustmentRecord[],
  filter: { lineItem: string; department?: string },
): Partial<Record<BudgetMonthKey, number>> {
  const net: Partial<Record<BudgetMonthKey, number>> = {}
  for (const a of adjustments) {
    if (a.status !== 'active') continue
    if (a.lineItem !== filter.lineItem) continue
    if (filter.department && a.department !== filter.department) continue
    for (const m of coveredMonths(a)) {
      net[m] = (net[m] ?? 0) + a.amount
    }
  }
  return net
}

export function annualNetAdjustment(netByMonth: Partial<Record<BudgetMonthKey, number>>): number {
  let sum = 0
  for (const m of ALL_BUDGET_MONTHS) sum += netByMonth[m] ?? 0
  return sum
}

// How much of the net adjustment lands in a given report column:
//   - 'period' → just the selected month
//   - 'ytd'    → months 01..selectedMonth (inclusive)
//   - 'annual' → all twelve months
export function foldAdjustmentForColumn(
  netByMonth: Partial<Record<BudgetMonthKey, number>>,
  column: BudgetReportColumnKey,
  selectedMonth: BudgetMonthKey,
): number {
  if (column === 'period') return netByMonth[selectedMonth] ?? 0
  if (column === 'annual') return annualNetAdjustment(netByMonth)
  const end = ALL_BUDGET_MONTHS.indexOf(selectedMonth)
  let sum = 0
  for (let i = 0; i <= end; i++) sum += netByMonth[ALL_BUDGET_MONTHS[i]] ?? 0
  return sum
}
