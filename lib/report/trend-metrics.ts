import { PNL_GROUPS, type PnlGroup, type PnlKind } from './pnl-inventory'
import type { FinancialMonth } from '@/lib/presentation/financials'

export type TrendMetric = 'revenue' | 'expense' | 'netIncome' | `group:${PnlKind}|${PnlGroup}` | `bundle:${string}`

export function trendMetricLabel(metric: TrendMetric): string {
  if (metric === 'revenue') return 'Revenue'
  if (metric === 'expense') return 'Expenses'
  if (metric === 'netIncome') return 'Net income'
  if (metric.startsWith('bundle:')) return 'Selected expenses'
  return PNL_GROUPS[metric.slice(6).split('|')[1] as PnlGroup]
}

export function trendMetricAmount(row: FinancialMonth | null, metric: TrendMetric): number | null {
  if (!row) return null
  if (metric === 'revenue') return row.totals.revenue + row.totals.otherIncome
  if (metric === 'expense') return row.totals.expense + row.totals.otherExpense
  if (metric === 'netIncome') return row.totals.netIncome
  if (metric.startsWith('bundle:')) {
    const groups = new Set(metric.slice(7).split(','))
    return row.inventory.groups.reduce((sum, item) => sum + ((item.kind === 'expense' || item.kind === 'other-expense') && groups.has(item.group) ? item.amount : 0), 0)
  }
  return row.inventory.groups.find((item) => `${item.kind}|${item.group}` === metric.slice(6))?.amount ?? 0
}

export function accountInTrendMetric(kind: PnlKind, group: PnlGroup, metric: TrendMetric): boolean {
  if (metric === 'netIncome') return true
  if (metric === 'revenue') return kind === 'income' || kind === 'other-income'
  if (metric === 'expense') return kind === 'expense' || kind === 'other-expense'
  if (metric.startsWith('bundle:')) return (kind === 'expense' || kind === 'other-expense') && metric.slice(7).split(',').includes(group)
  return `${kind}|${group}` === metric.slice(6)
}

export function trendAccountContribution(amount: number, kind: PnlKind, metric: TrendMetric): number {
  return metric === 'netIncome' && (kind === 'expense' || kind === 'other-expense') ? -amount : amount
}
