import { readCachedReportsInRange, readCachedReportsInRangeWithPeriod } from '@/lib/qb/cache-reads'
import { BUDGET_QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'

import {
  addBudgetLineAmounts,
  composeBudgetActualLineSet,
  getBudgetOverviewActualDateRanges,
  mapQboAccountTotalsToBudgetLines,
  parseQboProfitAndLossReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { loadBudgetQbMappingState } from './qb-mapping-db.ts'
import type {
  BudgetEntityScope,
  BudgetLineAmounts,
  BudgetActualLineSet,
  BudgetOverviewActualsState,
  BudgetRevenueMonthlyBreakdown,
  BudgetRevenueMonthEntry,
  BudgetMonthKey,
  BudgetViewState,
} from './types.ts'

const REVENUE_ACCOUNT_NUMBER = '40110'
const REVENUE_KEY = 'coreProductRevenue'
const REVENUE_ENTITY: QboEntity = 'Opco'
const MONTH_KEYS: BudgetMonthKey[] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']

function getBudgetQboEntities(entity: BudgetEntityScope): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

async function fetchCoreProductRevenueAmount(start: string, end: string): Promise<number> {
  // Aggregate across every monthly PnL in the requested range.
  const reports = await readCachedReportsInRange<QboProfitAndLossReport>(REVENUE_ENTITY, 'profit_and_loss', start, end)
  let total = 0
  for (const report of reports) {
    const totals = parseQboProfitAndLossReport(report)
    total += totals[REVENUE_ACCOUNT_NUMBER] ?? 0
  }
  return Math.abs(total)
}

function monthKeyFromPeriodStart(periodStart: string): BudgetMonthKey | null {
  const match = periodStart.match(/^\d{4}-(\d{2})-/)
  if (!match) return null
  const candidate = match[1] as BudgetMonthKey
  return MONTH_KEYS.includes(candidate) ? candidate : null
}

/**
 * Pure shaping helper: given the cached P&L rows for a year, build a 12-month
 * Core Product Revenue breakdown. Exposed for testing; production callers go
 * through `fetchCoreProductRevenueByMonth` which loads `rows` from the cache.
 */
export function composeCoreProductRevenueByMonth(
  year: number,
  rows: ReadonlyArray<{ periodStart: string; data: QboProfitAndLossReport }>,
  todayIso: string,
  fetchedAtIso: string = new Date().toISOString(),
): BudgetRevenueMonthlyBreakdown {
  const byMonth = new Map<BudgetMonthKey, number>()
  for (const row of rows) {
    const monthKey = monthKeyFromPeriodStart(row.periodStart)
    if (!monthKey) continue
    const totals = parseQboProfitAndLossReport(row.data)
    const amount = Math.abs(totals[REVENUE_ACCOUNT_NUMBER] ?? 0)
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amount)
  }

  const months: BudgetRevenueMonthEntry[] = MONTH_KEYS.map((monthKey) => ({
    month: monthKey,
    periodStart: `${year}-${monthKey}-01`,
    actualUsd: byMonth.get(monthKey) ?? 0,
  }))

  const annualTotalUsd = months.reduce((sum, entry) => sum + entry.actualUsd, 0)

  // YTD = sum of months whose periodStart is on or before today. For prior
  // years this equals annualTotalUsd; for the current year it stops at the
  // current month inclusive.
  const ytdTotalUsd = months
    .filter((entry) => entry.periodStart <= todayIso)
    .reduce((sum, entry) => sum + entry.actualUsd, 0)

  return {
    year,
    accountNumber: REVENUE_ACCOUNT_NUMBER,
    entity: REVENUE_ENTITY,
    months,
    ytdTotalUsd,
    annualTotalUsd,
    fetchedAt: fetchedAtIso,
  }
}

/**
 * Per-month Core Product Revenue for the given year, sourced from cached QB
 * P&L rows on Opco / account 40110. Always returns 12 entries (Jan–Dec); months
 * with no cached row come back with actualUsd: 0.
 */
export async function fetchCoreProductRevenueByMonth(year: number): Promise<BudgetRevenueMonthlyBreakdown> {
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const rows = await readCachedReportsInRangeWithPeriod<QboProfitAndLossReport>(
    REVENUE_ENTITY,
    'profit_and_loss',
    start,
    end,
  )
  const todayIso = new Date().toISOString().slice(0, 10)
  return composeCoreProductRevenueByMonth(year, rows, todayIso)
}

export async function fetchBudgetRevenueLineSet(
  ranges: ReturnType<typeof getBudgetOverviewActualDateRanges>,
): Promise<BudgetActualLineSet> {
  const [periodRevenue, ytdRevenue, annualRevenue] = await Promise.all([
    fetchCoreProductRevenueAmount(ranges.period.start, ranges.period.end),
    fetchCoreProductRevenueAmount(ranges.ytd.start, ranges.ytd.end),
    fetchCoreProductRevenueAmount(ranges.annual.start, ranges.annual.end),
  ])

  return {
    period: periodRevenue > 0 ? { [REVENUE_KEY]: periodRevenue } : {},
    ytd: ytdRevenue > 0 ? { [REVENUE_KEY]: ytdRevenue } : {},
    annual: annualRevenue > 0 ? { [REVENUE_KEY]: annualRevenue } : {},
  }
}

export async function fetchBudgetOverviewActuals(view: BudgetViewState): Promise<BudgetOverviewActualsState> {
  const mapping = await loadBudgetQbMappingState(view.year, true)
  const entities = getBudgetQboEntities(view.entity)
  const ranges = getBudgetOverviewActualDateRanges(view)

  async function getMappedLines(start: string, end: string): Promise<BudgetLineAmounts> {
    const totals: BudgetLineAmounts = {}

    const perEntityReports = await Promise.all(
      entities.map((entity) => readCachedReportsInRange<QboProfitAndLossReport>(entity, 'profit_and_loss', start, end)),
    )

    for (const reports of perEntityReports) {
      // Aggregate monthly PnL cache rows within the requested range.
      const aggregatedTotals: Record<string, number> = {}
      for (const report of reports) {
        const monthly = parseQboProfitAndLossReport(report)
        for (const [acct, amount] of Object.entries(monthly)) {
          aggregatedTotals[acct] = (aggregatedTotals[acct] ?? 0) + amount
        }
      }
      const mappedLines = mapQboAccountTotalsToBudgetLines(aggregatedTotals, mapping.rows)
      addBudgetLineAmounts(totals, mappedLines)
    }

    return totals
  }

  const [period, ytd, annual] = await Promise.all([
    getMappedLines(ranges.period.start, ranges.period.end),
    getMappedLines(ranges.ytd.start, ranges.ytd.end),
    getMappedLines(ranges.annual.start, ranges.annual.end),
  ])

  let lines = composeBudgetActualLineSet({ period, ytd, annual })

  try {
    const revenueLines = await fetchBudgetRevenueLineSet(ranges)
    lines = composeBudgetActualLineSet(lines, revenueLines)
  } catch {
    // Keep revenue blank if cache is empty; expense actuals still load.
  }

  return {
    source: 'quickbooks',
    year: view.year,
    view,
    fetchedAt: new Date().toISOString(),
    mappingSource: mapping.source,
    lines,
  }
}
