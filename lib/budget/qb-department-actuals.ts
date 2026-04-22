import {
  buildCachedTransactionPayloadFetcher,
  readCachedAccountCatalogByNumber,
  readCachedGeneralLedgerForAccount,
  readCachedReportsInRange,
  readCachedTransactionPayloads,
  type CachedTransactionPayload,
} from '@/lib/qb/cache-reads'
import { BUDGET_QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'

import {
  composeBudgetActualLineSet,
  getBudgetOverviewActualDateRanges,
  mergeGeneralLedgerReports,
  parseQboProfitAndLossReport,
  type QboGeneralLedgerReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { buildBudgetActualScopeAllocation, getBudgetActualScopeContribution } from './actual-allocation.ts'
import { parseQboGeneralLedgerRows } from './qb-general-ledger.ts'
import { loadBudgetActualLedgerTransactions } from './qb-ledger-transactions.ts'
import { fetchBudgetRevenueLineSet } from './qb-actuals.ts'
import { loadBudgetQbMappingState } from './qb-mapping-db.ts'
import type { BudgetQboTransactionPayloadCache } from './qb-transaction-payload.ts'
import type {
  BudgetDepartmentActualScope,
  BudgetLineAmounts,
  BudgetDepartmentActualsState,
  BudgetQbMappingRow,
  BudgetViewState,
} from './types.ts'

type DepartmentAccountTask = {
  entity: QboEntity
  rowKey: string
  accountNumber: string
  accountTotal: number
  accountId: string | null
}

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

function createEmptyLineAmounts(): BudgetLineAmounts {
  return {}
}

async function readAggregatedPnlTotals(
  entity: QboEntity,
  start: string,
  end: string,
): Promise<Record<string, number>> {
  const reports = await readCachedReportsInRange<QboProfitAndLossReport>(entity, 'profit_and_loss', start, end)
  const totals: Record<string, number> = {}
  for (const report of reports) {
    const monthly = parseQboProfitAndLossReport(report)
    for (const [acct, amount] of Object.entries(monthly)) {
      totals[acct] = (totals[acct] ?? 0) + amount
    }
  }
  return totals
}

function collectTxnIdsFromReports(reports: readonly QboGeneralLedgerReport[]): string[] {
  const ids = new Set<string>()
  for (const report of reports) {
    for (const row of parseQboGeneralLedgerRows(report)) {
      if (row.txnId) ids.add(row.txnId)
    }
  }
  return Array.from(ids)
}

async function getDepartmentLinesForRange(
  view: BudgetViewState,
  department: BudgetDepartmentActualScope,
  start: string,
  end: string,
  mappingRows: readonly BudgetQbMappingRow[],
  transactionPayloadCache: BudgetQboTransactionPayloadCache,
): Promise<{ lines: BudgetLineAmounts; unclassifiedLines: BudgetLineAmounts }> {
  const entities = getBudgetQboEntities(view.entity)
  const lines = createEmptyLineAmounts()
  const unclassifiedLines = createEmptyLineAmounts()

  for (const entity of entities) {
    const [accountTotals, accountCatalog] = await Promise.all([
      readAggregatedPnlTotals(entity, start, end),
      readCachedAccountCatalogByNumber(entity),
    ])

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
          accountId: accountCatalog.get(accountNumber)?.qbAccountId ?? null,
        })
      }
    }

    // Load per-account GL reports from cache for every account we're about
    // to process. Each account has its own rows in qb_report_cache.
    const perAccountGl = new Map<string, QboGeneralLedgerReport>()
    const allGlReports: QboGeneralLedgerReport[] = []
    for (const task of tasks) {
      if (perAccountGl.has(task.accountNumber)) continue
      const reports = await readCachedGeneralLedgerForAccount<QboGeneralLedgerReport>(
        entity, task.accountNumber, start, end,
      )
      if (reports.length === 0) continue
      const merged = mergeGeneralLedgerReports(reports)
      perAccountGl.set(task.accountNumber, merged)
      allGlReports.push(...reports)
    }

    const txnIds = collectTxnIdsFromReports(allGlReports)
    const payloadMap: Map<string, CachedTransactionPayload<unknown>> = txnIds.length
      ? await readCachedTransactionPayloads(entity, txnIds)
      : new Map()
    const cachedFetcher = buildCachedTransactionPayloadFetcher(payloadMap)

    for (const task of tasks) {
      const perAccountReport = perAccountGl.get(task.accountNumber)
      if (!perAccountReport) continue

      const ledgerTransactions = task.accountId
        ? await loadBudgetActualLedgerTransactions({
            entity: task.entity,
            accountNumber: task.accountNumber,
            accountName: accountCatalog.get(task.accountNumber)?.qbAccountName ?? null,
            accountId: task.accountId,
            report: perAccountReport,
            transactionPayloadCache,
            fetchTransactionPayload: cachedFetcher,
          })
        : { source: 'gl-report' as const, transactions: [] }

      const allocation = buildBudgetActualScopeAllocation(ledgerTransactions.transactions, task.accountTotal)
      const contribution = getBudgetActualScopeContribution(allocation, department)

      lines[task.rowKey] = (lines[task.rowKey] ?? 0) + contribution.totalUsd
      unclassifiedLines[task.rowKey] = (unclassifiedLines[task.rowKey] ?? 0)
        + allocation.unclassifiedTotalUsd
        + allocation.unresolvedTotalUsd
    }
  }

  return { lines, unclassifiedLines }
}

export async function fetchBudgetDepartmentActuals(
  view: BudgetViewState,
  department: BudgetDepartmentActualScope,
): Promise<BudgetDepartmentActualsState> {
  const mapping = await loadBudgetQbMappingState(view.year, true)
  const ranges = getBudgetOverviewActualDateRanges(view)
  const transactionPayloadCache: BudgetQboTransactionPayloadCache = new Map()

  const [period, ytd, annual] = await Promise.all([
    getDepartmentLinesForRange(view, department, ranges.period.start, ranges.period.end, mapping.rows, transactionPayloadCache),
    getDepartmentLinesForRange(view, department, ranges.ytd.start, ranges.ytd.end, mapping.rows, transactionPayloadCache),
    getDepartmentLinesForRange(view, department, ranges.annual.start, ranges.annual.end, mapping.rows, transactionPayloadCache),
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
