import {
  buildCachedTransactionPayloadFetcher,
  readCachedAccountCatalogByNumber,
  readCachedGeneralLedgerForAccount,
  readCachedReportsInRange,
  readCachedTransactionPayloads,
  type CachedAccount,
  type CachedTransactionPayload,
} from '@/lib/qb/cache-reads'
import { BUDGET_QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'

import {
  summarizeBudgetActualDrillAccounts,
} from './actual-drill-model.ts'
import { buildBudgetActualScopeAllocation, getBudgetActualScopeContribution } from './actual-allocation.ts'
import {
  mergeGeneralLedgerReports,
  parseQboProfitAndLossReport,
  type QboGeneralLedgerReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { getBudgetActualDrillRange } from './drill.ts'
import { parseQboGeneralLedgerRows } from './qb-general-ledger.ts'
import { loadBudgetActualLedgerTransactions } from './qb-ledger-transactions.ts'
import {
  attachBudgetActualDrillControlTotals,
  type BudgetActualDrillTask,
} from './qb-drill-plan.ts'
import { applyCouncilSubtraction, loadCouncilSubtractionByAccount } from './qb-class-exclusion.ts'
import { loadBudgetQbMappingState } from './qb-mapping-db.ts'
import type { BudgetQboTransactionPayloadCache } from './qb-transaction-payload.ts'
import type {
  BudgetActualDrillState,
  BudgetActualDrillTransaction,
  BudgetDepartmentActualScope,
  BudgetQbMappingRow,
  BudgetReportColumnKey,
  BudgetViewState,
} from './types.ts'

type DrillContributionBatch = {
  transactions: BudgetActualDrillTransaction[]
  totalUsd: number
  unreconciledTotalUsd: number
}

type BudgetActualDrillDependencies = {
  loadBudgetQbMappingState?: typeof loadBudgetQbMappingState
  loadBudgetActualLedgerTransactions?: typeof loadBudgetActualLedgerTransactions
}

const REVENUE_ACCOUNT_NUMBER = '40110'
const REVENUE_KEY = 'coreProductRevenue'

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
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

function buildDrillTasks(
  view: BudgetViewState,
  lineKeys: readonly string[],
  mappingRows: readonly BudgetQbMappingRow[],
): { tasks: BudgetActualDrillTask[]; mappingByAccount: Record<string, { mappingKeys: string[]; mappingLines: string[] }> } {
  const taskKeys = new Set<string>()
  const mappingByAccount = new Map<string, { mappingKeys: Set<string>; mappingLines: Set<string> }>()

  function addAccount(accountNumber: string, lineKey: string, lineLabel: string, entities: readonly QboEntity[]) {
    const existing = mappingByAccount.get(accountNumber) ?? {
      mappingKeys: new Set<string>(),
      mappingLines: new Set<string>(),
    }
    existing.mappingKeys.add(lineKey)
    existing.mappingLines.add(lineLabel)
    mappingByAccount.set(accountNumber, existing)

    for (const entity of entities) {
      taskKeys.add(`${entity}:${accountNumber}`)
    }
  }

  for (const row of mappingRows) {
    if (!lineKeys.includes(row.key)) continue
    for (const account of row.accounts) {
      addAccount(String(account), row.key, row.line, getBudgetQboEntities(view.entity))
    }
  }

  if (lineKeys.includes(REVENUE_KEY)) {
    addAccount(REVENUE_ACCOUNT_NUMBER, REVENUE_KEY, 'Core Product Revenue', ['Opco'])
  }

  return {
    tasks: Array.from(taskKeys).map((taskKey) => {
      const [entity, accountNumber] = taskKey.split(':')
      return { entity: entity as QboEntity, accountNumber }
    }),
    mappingByAccount: Object.fromEntries(
      Array.from(mappingByAccount.entries()).map(([accountNumber, mapping]) => [
        accountNumber,
        {
          mappingKeys: Array.from(mapping.mappingKeys),
          mappingLines: Array.from(mapping.mappingLines),
        },
      ]),
    ),
  }
}

export async function fetchBudgetActualDrill(
  view: BudgetViewState,
  column: BudgetReportColumnKey,
  lineKeys: readonly string[],
  department: BudgetDepartmentActualScope | null,
  dependencies: BudgetActualDrillDependencies = {},
): Promise<BudgetActualDrillState> {
  const loadMappingState = dependencies.loadBudgetQbMappingState ?? loadBudgetQbMappingState
  const loadLedgerTransactions = dependencies.loadBudgetActualLedgerTransactions ?? loadBudgetActualLedgerTransactions
  const mapping = await loadMappingState(view.year, true)
  const { tasks, mappingByAccount } = buildDrillTasks(view, lineKeys, mapping.rows)
  const range = getBudgetActualDrillRange(view, column, lineKeys)
  const effectiveDepartment = lineKeys.includes(REVENUE_KEY) ? null : department
  const transactionPayloadCache: BudgetQboTransactionPayloadCache = new Map()

  const entities = getBudgetQboEntities(view.entity)

  // PnL totals and account catalog can be preloaded per entity; per-account
  // GL reports load lazily since we only need the accounts the planned tasks
  // actually reference.
  const perEntity = await Promise.all(entities.map(async (entity) => {
    const [rawTotals, catalog, councilSubtraction] = await Promise.all([
      readAggregatedPnlTotals(entity, range.start, range.end),
      readCachedAccountCatalogByNumber(entity),
      loadCouncilSubtractionByAccount(entity, range.start, range.end),
    ])
    const totals = applyCouncilSubtraction(rawTotals, councilSubtraction)
    return { entity, totals, catalog }
  }))

  const accountTotalsByEntity: Record<string, Record<string, number>> = {}
  const catalogByEntity = new Map<QboEntity, Map<string, CachedAccount>>()
  for (const { entity, totals, catalog } of perEntity) {
    accountTotalsByEntity[entity] = totals
    catalogByEntity.set(entity, catalog)
  }

  const plannedTasks = attachBudgetActualDrillControlTotals(tasks, accountTotalsByEntity)

  // Per-account GL loads, deduped by (entity, accountNumber).
  const glByKey = new Map<string, QboGeneralLedgerReport>()
  async function loadAccountGl(entity: QboEntity, accountNumber: string): Promise<QboGeneralLedgerReport | null> {
    const key = `${entity}:${accountNumber}`
    if (glByKey.has(key)) return glByKey.get(key)!
    const reports = await readCachedGeneralLedgerForAccount<QboGeneralLedgerReport>(
      entity, accountNumber, range.start, range.end,
    )
    if (reports.length === 0) return null
    const merged = mergeGeneralLedgerReports(reports)
    glByKey.set(key, merged)
    return merged
  }

  // Preload transaction payloads per entity once all task accounts are known.
  const payloadFetcherByEntity = new Map<QboEntity, ReturnType<typeof buildCachedTransactionPayloadFetcher>>()
  async function getPayloadFetcher(entity: QboEntity, reports: readonly QboGeneralLedgerReport[]) {
    if (payloadFetcherByEntity.has(entity)) return payloadFetcherByEntity.get(entity)!
    const txnIds = collectTxnIdsFromReports(reports)
    const payloadMap: Map<string, CachedTransactionPayload<unknown>> = txnIds.length
      ? await readCachedTransactionPayloads(entity, txnIds)
      : new Map()
    const fetcher = buildCachedTransactionPayloadFetcher(payloadMap)
    payloadFetcherByEntity.set(entity, fetcher)
    return fetcher
  }

  const transactionBatches: DrillContributionBatch[] = []
  for (const task of plannedTasks) {
    const catalog = catalogByEntity.get(task.entity)
    const account = catalog?.get(task.accountNumber)
    const accountId = account?.qbAccountId ?? null

    const perAccountReport = accountId ? await loadAccountGl(task.entity, task.accountNumber) : null
    const ledgerResult = accountId && perAccountReport
      ? { source: 'quickbooks' as const, report: perAccountReport }
      : null

    const ledgerTransactions = ledgerResult
      ? await loadLedgerTransactions({
          entity: task.entity,
          accountNumber: task.accountNumber,
          accountName: account?.qbAccountName ?? null,
          accountId,
          report: ledgerResult.report,
          amountTransform: task.accountNumber === REVENUE_ACCOUNT_NUMBER ? (amountUsd) => Math.abs(amountUsd) : undefined,
          transactionPayloadCache,
          fetchTransactionPayload: await getPayloadFetcher(task.entity, [ledgerResult.report]),
        })
      : { source: 'gl-report' as const, transactions: [] }
    const allocation = buildBudgetActualScopeAllocation(ledgerTransactions.transactions, task.accountTotal)
    const contribution = getBudgetActualScopeContribution(allocation, effectiveDepartment)

    transactionBatches.push({
      transactions: contribution.transactions,
      totalUsd: contribution.transactionTotalUsd,
      unreconciledTotalUsd: contribution.unresolvedTotalUsd,
    })
  }

  const transactions = transactionBatches
    .flatMap((batch) => batch.transactions)
    .sort((left, right) => {
      const leftDate = left.date ?? ''
      const rightDate = right.date ?? ''
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
      if (left.entity !== right.entity) return left.entity.localeCompare(right.entity)
      return right.amountUsd - left.amountUsd
    })

  // Note: v1 had an enrichJournalEntryNames step that queried QB's
  // JournalEntry endpoint live. Skipped here: the per-transaction payloads
  // already cached by the cron carry Entity.EntityRef.name on each line, so
  // normalizeTransactionLine fills `name` at parse time.

  const accounts = summarizeBudgetActualDrillAccounts(transactions, mappingByAccount)
  const totalUsd = transactionBatches.reduce((sum, batch) => sum + batch.totalUsd, 0)
  const unreconciledTotalUsd = transactionBatches.reduce((sum, batch) => sum + batch.unreconciledTotalUsd, 0)

  return {
    source: 'quickbooks',
    year: view.year,
    view,
    department: effectiveDepartment,
    fetchedAt: new Date().toISOString(),
    mappingSource: mapping.source,
    lineKeys: [...lineKeys],
    totalUsd,
    unreconciledTotalUsd,
    accounts,
    transactions,
  }
}
