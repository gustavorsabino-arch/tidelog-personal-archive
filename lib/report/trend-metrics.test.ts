import { describe, expect, test } from 'bun:test'
import type { FinancialMonth } from '@/lib/presentation/financials'
import { accountInTrendMetric, trendAccountContribution, trendMetricAmount } from './trend-metrics'

const row = {
  totals: { revenue: 100, otherIncome: 20, expense: 45, otherExpense: 5, netIncome: 70 },
  inventory: { groups: [
    { kind: 'income', group: 'protocol-revenue', amount: 100 },
    { kind: 'other-income', group: 'other-income', amount: 20 },
    { kind: 'expense', group: 'employee-token', amount: 30 },
    { kind: 'expense', group: 'professional', amount: 15 },
    { kind: 'other-expense', group: 'intercompany', amount: 5 },
  ] },
} as FinancialMonth

describe('YTD selected metric', () => {
  test('matches QB section totals and selects only its own account rows', () => {
    expect(trendMetricAmount(row, 'revenue')).toBe(120)
    expect(trendMetricAmount(row, 'expense')).toBe(50)
    expect(trendMetricAmount(row, 'netIncome')).toBe(70)
    expect(trendMetricAmount(row, 'group:expense|employee-token')).toBe(30)
    expect(trendMetricAmount(row, 'group:other-income|employee-token')).toBe(0)
    expect(trendMetricAmount(null, 'expense')).toBeNull()
    expect(accountInTrendMetric('expense', 'employee-token', 'group:expense|employee-token')).toBe(true)
    expect(accountInTrendMetric('other-income', 'other-income', 'group:expense|employee-token')).toBe(false)
    expect(accountInTrendMetric('other-expense', 'intercompany', 'expense')).toBe(true)
    expect(accountInTrendMetric('income', 'protocol-revenue', 'expense')).toBe(false)
  })

  test('net income account breakdown uses the QB sign bridge', () => {
    expect([100, 20, 45, 5].reduce((sum, amount, index) => sum + trendAccountContribution(amount, ['income', 'other-income', 'expense', 'other-expense'][index] as Parameters<typeof trendAccountContribution>[1], 'netIncome'), 0)).toBe(70)
  })
})
