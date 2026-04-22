import { readCachedReportsInRange } from '@/lib/qb/cache-reads'
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
  BudgetViewState,
} from './types.ts'

const REVENUE_ACCOUNT_NUMBER = '40110'
const REVENUE_KEY = 'coreProductRevenue'

function getBudgetQboEntities(entity: BudgetEntityScope): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

async function fetchCoreProductRevenueAmount(start: string, end: string): Promise<number> {
  // Aggregate across every monthly PnL in the requested range.
  const reports = await readCachedReportsInRange<QboProfitAndLossReport>('Opco', 'profit_and_loss', start, end)
  let total = 0
  for (const report of reports) {
    const totals = parseQboProfitAndLossReport(report)
    total += totals[REVENUE_ACCOUNT_NUMBER] ?? 0
  }
  return Math.abs(total)
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
