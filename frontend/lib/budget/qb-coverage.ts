import 'server-only'

import { fetchQboJson } from '@/lib/qb/client'
import { BUDGET_QBO_ENTITIES, getQboRealmId, type QboEntity } from '@/lib/qb/config'

import { getBudgetOverviewActualDateRanges, parseQboProfitAndLossReport, type QboProfitAndLossAccountTotals, type QboProfitAndLossReport } from './actuals.ts'
import { loadBudgetQbMappingState } from './qb-mapping.ts'
import { buildBudgetCoverageState } from './qb-coverage-model.ts'
import type { BudgetCoverageState, BudgetViewState } from './types.ts'

type QboAccountQueryResponse = {
  QueryResponse?: {
    Account?: Array<{
      AcctNum?: string
      Name?: string
    }>
  }
}

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

function buildProfitAndLossPath(entity: QboEntity, start: string, end: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/reports/ProfitAndLoss?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&accounting_method=Accrual&minorversion=65`
}

function buildAccountQueryPath(entity: QboEntity): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent('SELECT * FROM Account MAXRESULTS 1000')}&minorversion=65`
}

async function fetchProfitAndLossReport(entity: QboEntity, start: string, end: string): Promise<QboProfitAndLossReport> {
  return fetchQboJson<QboProfitAndLossReport>(entity, buildProfitAndLossPath(entity, start, end))
}

async function fetchAccountNames(entity: QboEntity): Promise<Record<string, string>> {
  const response = await fetchQboJson<QboAccountQueryResponse>(entity, buildAccountQueryPath(entity))
  const accounts = response.QueryResponse?.Account ?? []
  const result: Record<string, string> = {}

  for (const account of accounts) {
    const accountNumber = String(account.AcctNum ?? '').trim()
    const accountName = String(account.Name ?? '').trim()
    if (accountNumber && accountName) {
      result[accountNumber] = accountName
    }
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
    const [report, entityAccountNames] = await Promise.all([
      fetchProfitAndLossReport(entity, ranges.period.start, ranges.period.end),
      fetchAccountNames(entity),
    ])

    const entityTotals = parseQboProfitAndLossReport(report)
    for (const [accountNumber, amount] of Object.entries(entityTotals)) {
      accountTotals[accountNumber] = (accountTotals[accountNumber] ?? 0) + amount
    }
    for (const [accountNumber, accountName] of Object.entries(entityAccountNames)) {
      if (!accountNames[accountNumber]) {
        accountNames[accountNumber] = accountName
      }
    }
  }))

  return buildBudgetCoverageState(view, mapping.rows, accountTotals, accountNames, mapping.source)
}
