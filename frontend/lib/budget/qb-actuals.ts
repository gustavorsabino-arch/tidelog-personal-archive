import 'server-only'

import { fetchQboJson } from '@/lib/qb/client'
import { BUDGET_QBO_ENTITIES, getQboRealmId, type QboEntity } from '@/lib/qb/config'

import {
  addBudgetLineAmounts,
  composeBudgetActualLineSet,
  getBudgetOverviewActualDateRanges,
  mapQboAccountTotalsToBudgetLines,
  parseQboProfitAndLossReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { loadBudgetQbMappingState } from './qb-mapping.ts'
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

async function fetchProfitAndLossReport(entity: QboEntity, start: string, end: string): Promise<QboProfitAndLossReport> {
  const realmId = getQboRealmId(entity)
  const path = `/v3/company/${encodeURIComponent(realmId)}/reports/ProfitAndLoss?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&accounting_method=Accrual&minorversion=65`
  return fetchQboJson<QboProfitAndLossReport>(entity, path)
}

async function fetchCoreProductRevenueAmount(start: string, end: string): Promise<number> {
  const revenueReport = await fetchProfitAndLossReport('Opco', start, end)
  const revenueTotals = parseQboProfitAndLossReport(revenueReport)
  return Math.abs(revenueTotals[REVENUE_ACCOUNT_NUMBER] ?? 0)
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
  const responseCache = new Map<string, Promise<QboProfitAndLossReport>>()

  async function getMappedLines(start: string, end: string): Promise<BudgetLineAmounts> {
    const totals: BudgetLineAmounts = {}

    await Promise.all(entities.map(async (entity) => {
      const cacheKey = `${entity}:${start}:${end}`
      const reportPromise = responseCache.get(cacheKey)
        ?? fetchProfitAndLossReport(entity, start, end)
      responseCache.set(cacheKey, reportPromise)

      const report = await reportPromise
      const accountTotals = parseQboProfitAndLossReport(report)
      const mappedLines = mapQboAccountTotalsToBudgetLines(accountTotals, mapping.rows)
      addBudgetLineAmounts(totals, mappedLines)
    }))

    return totals
  }

  const [period, ytd, annual] = await Promise.all([
    getMappedLines(ranges.period.start, ranges.period.end),
    getMappedLines(ranges.ytd.start, ranges.ytd.end),
    getMappedLines(ranges.annual.start, ranges.annual.end),
  ])

  let lines = composeBudgetActualLineSet({
    period,
    ytd,
    annual,
  })

  try {
    const revenueLines = await fetchBudgetRevenueLineSet(ranges)
    lines = composeBudgetActualLineSet(lines, revenueLines)
  } catch {
    // Keep revenue blank when Opco is not connected; expense actuals should still load.
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
