import { readCachedAccountCatalog, readCachedReportsInRange } from '@/lib/qb/cache-reads'
import { BUDGET_QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'

import { getBudgetOverviewActualDateRanges, parseQboProfitAndLossReport, type QboProfitAndLossAccountTotals, type QboProfitAndLossReport } from './actuals.ts'
import { loadBudgetQbMappingState } from './qb-mapping-db.ts'
import { buildBudgetCoverageState } from './qb-coverage-model.ts'
import type { BudgetCoverageState, BudgetViewState } from './types.ts'

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

async function fetchAccountNamesFromCache(entity: QboEntity): Promise<Record<string, string>> {
  const accounts = await readCachedAccountCatalog(entity)
  const result: Record<string, string> = {}
  for (const account of accounts) {
    if (!account.qbAccountNumber) continue
    result[account.qbAccountNumber] = account.qbAccountName
  }
  return result
}

export async function fetchBudgetCoverage(view: BudgetViewState): Promise<BudgetCoverageState> {
  const mapping = await loadBudgetQbMappingState(view.year, true)
  const ranges = getBudgetOverviewActualDateRanges(view)
  const entities = getBudgetQboEntities(view.entity)

  const accountTotals: QboProfitAndLossAccountTotals = {}
  const accountNames: Record<string, string> = {}

  await Promise.all(entities.map(async (entity) => {
    const [reports, entityAccountNames] = await Promise.all([
      readCachedReportsInRange<QboProfitAndLossReport>(entity, 'profit_and_loss', ranges.period.start, ranges.period.end),
      fetchAccountNamesFromCache(entity),
    ])

    for (const report of reports) {
      const entityTotals = parseQboProfitAndLossReport(report)
      for (const [accountNumber, amount] of Object.entries(entityTotals)) {
        accountTotals[accountNumber] = (accountTotals[accountNumber] ?? 0) + amount
      }
    }
    for (const [accountNumber, accountName] of Object.entries(entityAccountNames)) {
      if (!accountNames[accountNumber]) {
        accountNames[accountNumber] = accountName
      }
    }
  }))

  return buildBudgetCoverageState(view, mapping.rows, accountTotals, accountNames, mapping.source)
}
