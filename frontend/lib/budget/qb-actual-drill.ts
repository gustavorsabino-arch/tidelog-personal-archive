import 'server-only'

import { fetchQboJson } from '@/lib/qb/client'
import { BUDGET_QBO_ENTITIES, getQboRealmId, type QboEntity } from '@/lib/qb/config'

import {
  pickBudgetActualDrillNameFromJournalEntry,
  summarizeBudgetActualDrillAccounts,
} from './actual-drill-model.ts'
import { buildBudgetActualScopeAllocation, getBudgetActualScopeContribution } from './actual-allocation.ts'
import {
  parseQboProfitAndLossReport,
  type QboGeneralLedgerReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { getBudgetActualDrillRange } from './drill.ts'
import { loadBudgetActualLedgerTransactions } from './qb-ledger-transactions.ts'
import {
  attachBudgetActualDrillControlTotals,
  type BudgetActualDrillTask,
} from './qb-drill-plan.ts'
import { loadBudgetQbMappingState } from './qb-mapping.ts'
import type { BudgetQboTransactionPayloadCache } from './qb-transaction-payload.ts'
import type { BudgetActualDrillState, BudgetActualDrillTransaction, BudgetDepartmentActualScope, BudgetQbMappingRow, BudgetReportColumnKey, BudgetViewState } from './types.ts'

type QboAccountQueryResponse = {
  QueryResponse?: {
    Account?: Array<{
      Id?: string
      AcctNum?: string
      Name?: string
    }>
  }
}

type QboJournalEntryQueryResponse = {
  QueryResponse?: {
    JournalEntry?: Array<{
      Id?: string | number
      Line?: Array<{
        Amount?: string | number
        JournalEntryLineDetail?: {
          Entity?: {
            EntityRef?: {
              name?: string
            }
          }
        }
      }>
    }>
  }
}

type AccountCatalogEntry = {
  id: string | null
  name: string | null
}

type DrillContributionBatch = {
  transactions: BudgetActualDrillTransaction[]
  totalUsd: number
  unreconciledTotalUsd: number
}

type BudgetActualDrillDependencies = {
  fetchQboJson?: typeof fetchQboJson
  loadBudgetQbMappingState?: typeof loadBudgetQbMappingState
  loadBudgetActualLedgerTransactions?: typeof loadBudgetActualLedgerTransactions
}

const REVENUE_ACCOUNT_NUMBER = '40110'
const REVENUE_KEY = 'coreProductRevenue'
const DRILL_GL_CONCURRENCY = 3

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

function buildAccountQueryPath(entity: QboEntity): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent('SELECT * FROM Account MAXRESULTS 1000')}&minorversion=65`
}

function buildJournalEntryQueryPath(entity: QboEntity, start: string, end: string, startPosition: number): string {
  const realmId = getQboRealmId(entity)
  const query = `SELECT * FROM JournalEntry WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION ${startPosition} MAXRESULTS 1000`
  return `/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=65`
}

function buildProfitAndLossPath(entity: QboEntity, start: string, end: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/reports/ProfitAndLoss?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&accounting_method=Accrual&minorversion=65`
}

function buildGeneralLedgerPath(entity: QboEntity, start: string, end: string, accountId: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/reports/GeneralLedger?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&account=${encodeURIComponent(accountId)}&columns=tx_date,txn_type,doc_num,name,klass_name,memo,subt_nat_amount,rbal_nat_amount&accounting_method=Accrual&minorversion=65`
}

async function runWithConcurrency<T, TResult>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const queue = [...items]
  const results: TResult[] = []
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length || 1)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      results.push(await worker(item))
    }
  })

  await Promise.all(workers)
  return results
}

async function fetchAccountCatalog(
  entity: QboEntity,
  cache: Map<string, Promise<Record<string, AccountCatalogEntry>>>,
  fetchJson: typeof fetchQboJson,
): Promise<Record<string, AccountCatalogEntry>> {
  const cached = cache.get(entity)
  if (cached) return cached

  const promise = fetchJson<QboAccountQueryResponse>(entity, buildAccountQueryPath(entity))
    .then((response) => {
      const result: Record<string, AccountCatalogEntry> = {}
      for (const account of response.QueryResponse?.Account ?? []) {
        const accountNumber = String(account.AcctNum ?? '').trim()
        if (!accountNumber) continue

        result[accountNumber] = {
          id: String(account.Id ?? '').trim() || null,
          name: String(account.Name ?? '').trim() || null,
        }
      }
      return result
    })

  cache.set(entity, promise)
  return promise
}

async function fetchGeneralLedgerReport(
  entity: QboEntity,
  start: string,
  end: string,
  accountId: string,
  cache: Map<string, Promise<QboGeneralLedgerReport>>,
  fetchJson: typeof fetchQboJson,
): Promise<QboGeneralLedgerReport> {
  const key = `${entity}:${accountId}:${start}:${end}`
  const cached = cache.get(key)
  if (cached) return cached

  const promise = fetchJson<QboGeneralLedgerReport>(entity, buildGeneralLedgerPath(entity, start, end, accountId))
  cache.set(key, promise)
  return promise
}

function parseJournalEntryLineAmount(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  return Number.parseFloat(String(value ?? '0').replace(/,/g, '')) || 0
}

async function enrichJournalEntryNames(
  transactions: BudgetActualDrillTransaction[],
  range: { start: string; end: string },
) {
  const rowsToEnrich = transactions.filter((transaction) => (
    !transaction.name
    && !!transaction.txnId
    && !!transaction.realmId
    && (transaction.transactionType ?? '').toLowerCase().includes('journal')
  ))

  if (rowsToEnrich.length === 0) return

  const rowsByEntity = new Map<QboEntity, typeof rowsToEnrich>()
  for (const row of rowsToEnrich) {
    const entityRows = rowsByEntity.get(row.entity as QboEntity) ?? []
    entityRows.push(row)
    rowsByEntity.set(row.entity as QboEntity, entityRows)
  }

  for (const [entity, entityRows] of rowsByEntity.entries()) {
    const txnIds = new Set(entityRows.map((row) => row.txnId!))
    const journalEntryCache = new Map<string, { lines: Array<{ amount: number; name: string }>; fallback: string }>()
    let startPosition = 1

    while (txnIds.size > 0) {
      const response = await fetchQboJson<QboJournalEntryQueryResponse>(
        entity,
        buildJournalEntryQueryPath(entity, range.start, range.end, startPosition),
      )
      const journalEntries = response.QueryResponse?.JournalEntry ?? []
      if (journalEntries.length === 0) break

      for (const entry of journalEntries) {
        const id = String(entry.Id ?? '').trim()
        if (!id || !txnIds.has(id)) continue

        const lines = (entry.Line ?? [])
          .map((line) => ({
            amount: Math.abs(parseJournalEntryLineAmount(line.Amount)),
            name: line.JournalEntryLineDetail?.Entity?.EntityRef?.name?.trim() ?? '',
          }))
          .filter((line) => line.name)

        journalEntryCache.set(id, {
          lines,
          fallback: lines[0]?.name ?? '',
        })
        txnIds.delete(id)
      }

      if (journalEntries.length < 1000) break
      startPosition += 1000
    }

    for (const row of entityRows) {
      const cached = row.txnId ? journalEntryCache.get(row.txnId) : null
      if (!cached) continue

      row.name = pickBudgetActualDrillNameFromJournalEntry(cached.lines, row.amountUsd) ?? cached.fallback ?? row.name
    }
  }
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
  const fetchJson = dependencies.fetchQboJson ?? fetchQboJson
  const loadMappingState = dependencies.loadBudgetQbMappingState ?? loadBudgetQbMappingState
  const loadLedgerTransactions = dependencies.loadBudgetActualLedgerTransactions ?? loadBudgetActualLedgerTransactions
  const mapping = await loadMappingState(view.year, true)
  const { tasks, mappingByAccount } = buildDrillTasks(view, lineKeys, mapping.rows)
  const range = getBudgetActualDrillRange(view, column, lineKeys)
  const effectiveDepartment = lineKeys.includes(REVENUE_KEY) ? null : department
  const accountCatalogCache = new Map<string, Promise<Record<string, AccountCatalogEntry>>>()
  const glCache = new Map<string, Promise<QboGeneralLedgerReport>>()
  const pnlCache = new Map<string, Promise<QboProfitAndLossReport>>()
  const transactionPayloadCache: BudgetQboTransactionPayloadCache = new Map()

  const entities = getBudgetQboEntities(view.entity)

  const accountTotalsByEntity = Object.fromEntries(await Promise.all(entities.map(async (entity) => {
    const key = `${entity}:${range.start}:${range.end}`
    let promise = pnlCache.get(key)
    if (!promise) {
      promise = fetchJson<QboProfitAndLossReport>(entity, buildProfitAndLossPath(entity, range.start, range.end))
      pnlCache.set(key, promise)
    }
    const report = await promise
    return [entity, parseQboProfitAndLossReport(report)] as const
  }))) as Record<string, Record<string, number>>
  const plannedTasks = attachBudgetActualDrillControlTotals(tasks, accountTotalsByEntity)

  const transactionBatches = await runWithConcurrency(plannedTasks, DRILL_GL_CONCURRENCY, async (task): Promise<DrillContributionBatch> => {
    // Drill parity depends on ledger activity, not only the net P&L total.
    // Zero-net accounts can still contain visible offsetting rows that v1 showed.
    const catalog = await fetchAccountCatalog(task.entity, accountCatalogCache, fetchJson)
    const account = catalog[task.accountNumber]
    const ledgerResult = account?.id
      ? {
        source: 'quickbooks' as const,
        report: await fetchGeneralLedgerReport(task.entity, range.start, range.end, account.id, glCache, fetchJson),
      }
      : null

    const ledgerTransactions = ledgerResult
      ? await loadLedgerTransactions({
        entity: task.entity,
        accountNumber: task.accountNumber,
        accountName: account?.name ?? null,
        accountId: account?.id ?? null,
        report: ledgerResult.report,
        amountTransform: task.accountNumber === REVENUE_ACCOUNT_NUMBER ? (amountUsd) => Math.abs(amountUsd) : undefined,
        transactionPayloadCache,
      })
      : { source: 'gl-report' as const, transactions: [] }
    const allocation = buildBudgetActualScopeAllocation(ledgerTransactions.transactions, task.accountTotal)
    const contribution = getBudgetActualScopeContribution(allocation, effectiveDepartment)

    return {
      transactions: contribution.transactions,
      totalUsd: contribution.transactionTotalUsd,
      unreconciledTotalUsd: contribution.unresolvedTotalUsd,
    }
  })

  const transactions = transactionBatches
    .flatMap((batch) => batch.transactions)
    .sort((left, right) => {
      const leftDate = left.date ?? ''
      const rightDate = right.date ?? ''
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
      if (left.entity !== right.entity) return left.entity.localeCompare(right.entity)
      return right.amountUsd - left.amountUsd
    })

  await enrichJournalEntryNames(transactions, range)

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
