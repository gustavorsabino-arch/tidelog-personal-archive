import 'server-only'

import { fetchQboJson } from '@/lib/qb/client'
import { BUDGET_QBO_ENTITIES, getQboRealmId, type QboEntity } from '@/lib/qb/config'

import {
  composeBudgetActualLineSet,
  getBudgetOverviewActualDateRanges,
  parseQboProfitAndLossReport,
  type QboGeneralLedgerReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { buildBudgetActualScopeAllocation, getBudgetActualScopeContribution } from './actual-allocation.ts'
import { loadBudgetActualLedgerTransactions } from './qb-ledger-transactions.ts'
import { fetchBudgetRevenueLineSet } from './qb-actuals.ts'
import { loadBudgetQbMappingState } from './qb-mapping.ts'
import type { BudgetQboTransactionPayloadCache } from './qb-transaction-payload.ts'
import type {
  BudgetDepartmentActualScope,
  BudgetLineAmounts,
  BudgetDepartmentActualsState,
  BudgetQbMappingRow,
  BudgetViewState,
} from './types.ts'

type QboAccountQueryResponse = {
  QueryResponse?: {
    Account?: Array<{
      Id?: string
      AcctNum?: string
      Name?: string
    }>
  }
}

type QboAccountIdMap = Record<string, string>
type DepartmentAccountTask = {
  entity: QboEntity
  rowKey: string
  accountNumber: string
  accountTotal: number
  accountId?: string
}

const GL_CONCURRENCY = 2

function createEmptyLineAmounts(): BudgetLineAmounts {
  return {}
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length || 1)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      await worker(item)
    }
  })

  await Promise.all(workers)
}

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

function buildQueryPath(entity: QboEntity, query: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=65`
}

function buildGeneralLedgerPath(entity: QboEntity, start: string, end: string, accountId: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/reports/GeneralLedger?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&account=${encodeURIComponent(accountId)}&columns=tx_date,txn_type,doc_num,name,klass_name,memo,subt_nat_amount,rbal_nat_amount&accounting_method=Accrual&minorversion=65`
}

function buildProfitAndLossPath(entity: QboEntity, start: string, end: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/reports/ProfitAndLoss?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&accounting_method=Accrual&minorversion=65`
}

function buildAccountIdMap(response: QboAccountQueryResponse): QboAccountIdMap {
  const accounts = response.QueryResponse?.Account ?? []
  const result: QboAccountIdMap = {}

  for (const account of accounts) {
    const id = String(account.Id ?? '').trim()
    if (!id) continue

    const accountNumber = String(account.AcctNum ?? '').trim()
    if (accountNumber) {
      result[accountNumber] = id
      continue
    }

    const name = String(account.Name ?? '')
    const match = name.match(/^(\d{4,6})\s/)
    if (match) {
      result[match[1]] = id
    }
  }

  return result
}

async function fetchAccountIdMap(
  entity: QboEntity,
  cache: Map<string, Promise<QboAccountIdMap>>,
): Promise<QboAccountIdMap> {
  const cached = cache.get(entity)
  if (cached) return cached

  const promise = fetchQboJson<QboAccountQueryResponse>(
    entity,
    buildQueryPath(entity, 'SELECT * FROM Account MAXRESULTS 1000'),
  ).then(buildAccountIdMap)

  cache.set(entity, promise)
  return promise
}

async function fetchProfitAndLossReport(
  entity: QboEntity,
  start: string,
  end: string,
  cache: Map<string, Promise<QboProfitAndLossReport>>,
): Promise<QboProfitAndLossReport> {
  const key = `${entity}:${start}:${end}`
  const cached = cache.get(key)
  if (cached) return cached

  const promise = fetchQboJson<QboProfitAndLossReport>(entity, buildProfitAndLossPath(entity, start, end))
  cache.set(key, promise)
  return promise
}

async function fetchGeneralLedgerReport(
  entity: QboEntity,
  start: string,
  end: string,
  accountId: string,
  cache: Map<string, Promise<QboGeneralLedgerReport>>,
): Promise<QboGeneralLedgerReport> {
  const key = `${entity}:${accountId}:${start}:${end}`
  const cached = cache.get(key)
  if (cached) return cached

  const promise = fetchQboJson<QboGeneralLedgerReport>(entity, buildGeneralLedgerPath(entity, start, end, accountId))
  cache.set(key, promise)
  return promise
}

async function getDepartmentLinesForRange(
  view: BudgetViewState,
  department: BudgetDepartmentActualScope,
  start: string,
  end: string,
  mappingRows: readonly BudgetQbMappingRow[],
  accountMapCache: Map<string, Promise<QboAccountIdMap>>,
  pnlCache: Map<string, Promise<QboProfitAndLossReport>>,
  glCache: Map<string, Promise<QboGeneralLedgerReport>>,
  transactionPayloadCache: BudgetQboTransactionPayloadCache,
): Promise<{ lines: BudgetLineAmounts; unclassifiedLines: BudgetLineAmounts }> {
  const entities = getBudgetQboEntities(view.entity)
  const lines = createEmptyLineAmounts()
  const unclassifiedLines = createEmptyLineAmounts()

  for (const entity of entities) {
    const [accountIdMap, pnlReport] = await Promise.all([
      fetchAccountIdMap(entity, accountMapCache),
      fetchProfitAndLossReport(entity, start, end, pnlCache),
    ])

    const accountTotals = parseQboProfitAndLossReport(pnlReport)
    const tasks: DepartmentAccountTask[] = []
    for (const row of mappingRows) {
      for (const account of row.accounts) {
        const accountNumber = String(account)
        const accountTotal = accountTotals[accountNumber] ?? 0
        if (!accountTotal) continue

        tasks.push({
          entity,
          rowKey: row.key,
          accountNumber,
          accountTotal,
          accountId: accountIdMap[accountNumber],
        })
      }
    }

    await runWithConcurrency(tasks, GL_CONCURRENCY, async (task) => {
      const ledgerResult = task.accountId
        ? {
          source: 'quickbooks' as const,
          report: await fetchGeneralLedgerReport(task.entity, start, end, task.accountId, glCache),
        }
        : null

      const ledgerTransactions = ledgerResult
        ? await loadBudgetActualLedgerTransactions({
          entity: task.entity,
          accountNumber: task.accountNumber,
          accountName: null,
          accountId: task.accountId ?? null,
          report: ledgerResult.report,
          transactionPayloadCache,
        })
        : { source: 'gl-report' as const, transactions: [] }
      const allocation = buildBudgetActualScopeAllocation(ledgerTransactions.transactions, task.accountTotal)
      const contribution = getBudgetActualScopeContribution(allocation, department)

      lines[task.rowKey] = (lines[task.rowKey] ?? 0) + contribution.totalUsd
      unclassifiedLines[task.rowKey] = (unclassifiedLines[task.rowKey] ?? 0)
        + allocation.unclassifiedTotalUsd
        + allocation.unresolvedTotalUsd
    })
  }

  return { lines, unclassifiedLines }
}

export async function fetchBudgetDepartmentActuals(
  view: BudgetViewState,
  department: BudgetDepartmentActualScope,
): Promise<BudgetDepartmentActualsState> {
  const mapping = await loadBudgetQbMappingState(view.year, true)
  const ranges = getBudgetOverviewActualDateRanges(view)
  const accountMapCache = new Map<string, Promise<QboAccountIdMap>>()
  const pnlCache = new Map<string, Promise<QboProfitAndLossReport>>()
  const glCache = new Map<string, Promise<QboGeneralLedgerReport>>()
  const transactionPayloadCache: BudgetQboTransactionPayloadCache = new Map()

  const [period, ytd, annual] = await Promise.all([
    getDepartmentLinesForRange(view, department, ranges.period.start, ranges.period.end, mapping.rows, accountMapCache, pnlCache, glCache, transactionPayloadCache),
    getDepartmentLinesForRange(view, department, ranges.ytd.start, ranges.ytd.end, mapping.rows, accountMapCache, pnlCache, glCache, transactionPayloadCache),
    getDepartmentLinesForRange(view, department, ranges.annual.start, ranges.annual.end, mapping.rows, accountMapCache, pnlCache, glCache, transactionPayloadCache),
  ])

  let lines = composeBudgetActualLineSet({
    period: period.lines,
    ytd: ytd.lines,
    annual: annual.lines,
  })
  const unclassifiedLines = composeBudgetActualLineSet({
    period: period.unclassifiedLines,
    ytd: ytd.unclassifiedLines,
    annual: annual.unclassifiedLines,
  })

  try {
    const revenueLines = await fetchBudgetRevenueLineSet(ranges)
    lines = composeBudgetActualLineSet(lines, revenueLines)
  } catch {
    // Keep department expense actuals even if Opco revenue cannot be loaded.
  }

  return {
    source: 'quickbooks',
    year: view.year,
    view,
    department,
    fetchedAt: new Date().toISOString(),
    mappingSource: mapping.source,
    lines,
    unclassifiedLines,
  }
}
