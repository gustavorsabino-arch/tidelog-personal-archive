import {
  buildCachedTransactionPayloadFetcher,
  readCachedAccountCatalogByNumber,
  readCachedGeneralLedgerForAccount,
  readCachedTransactionPayloads,
  type CachedTransactionPayload,
} from '@/lib/qb/cache-reads'
import { BUDGET_QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'

import {
  mergeGeneralLedgerReports,
  type QboGeneralLedgerReport,
} from './actuals.ts'
import { getBudgetActualDrillRange } from './drill.ts'
import { parseQboGeneralLedgerRows } from './qb-general-ledger.ts'
import { loadBudgetActualLedgerTransactions } from './qb-ledger-transactions.ts'
import type {
  BudgetActualDrillState,
  BudgetActualDrillTransaction,
  BudgetReportColumnKey,
  BudgetViewState,
} from './types.ts'

const ACCOUNT_NUMBER_PATTERN = /^\d+$/

export type BudgetAccountDrillTask = {
  entity: QboEntity
  accountNumber: string
}

export function synthesizeAccountDrillTasks(
  view: BudgetViewState,
  accountNumber: string,
): BudgetAccountDrillTask[] {
  const trimmed = accountNumber.trim()
  if (!ACCOUNT_NUMBER_PATTERN.test(trimmed)) {
    throw new Error(`accountNumber must be a numeric token, got "${accountNumber}"`)
  }
  const entities: QboEntity[] = view.entity === 'All' ? [...BUDGET_QBO_ENTITIES] : [view.entity]
  return entities.map((entity) => ({ entity, accountNumber: trimmed }))
}

function collectTxnIds(report: QboGeneralLedgerReport): string[] {
  const ids = new Set<string>()
  for (const row of parseQboGeneralLedgerRows(report)) {
    if (row.txnId) ids.add(row.txnId)
  }
  return Array.from(ids)
}

export async function fetchBudgetAccountDrill(
  view: BudgetViewState,
  accountNumber: string,
): Promise<BudgetActualDrillState> {
  const tasks = synthesizeAccountDrillTasks(view, accountNumber)
  // Coverage panel scope is always the period range; line-key drill uses the
  // same helper.
  const column: BudgetReportColumnKey = 'period'
  const range = getBudgetActualDrillRange(view, column, [])

  const transactions: BudgetActualDrillTransaction[] = []
  let totalUsd = 0
  const unreconciledTotalUsd = 0

  for (const task of tasks) {
    const catalog = await readCachedAccountCatalogByNumber(task.entity)
    const account = catalog.get(task.accountNumber)
    if (!account) continue

    const reports = await readCachedGeneralLedgerForAccount<QboGeneralLedgerReport>(
      task.entity,
      task.accountNumber,
      range.start,
      range.end,
    )
    if (reports.length === 0) continue
    const merged = mergeGeneralLedgerReports(reports)

    const txnIds = collectTxnIds(merged)
    const payloadMap: Map<string, CachedTransactionPayload<unknown>> = txnIds.length
      ? await readCachedTransactionPayloads(task.entity, txnIds)
      : new Map()
    const fetcher = buildCachedTransactionPayloadFetcher(payloadMap)

    const result = await loadBudgetActualLedgerTransactions({
      entity: task.entity,
      accountNumber: task.accountNumber,
      accountName: account.qbAccountName ?? null,
      accountId: account.qbAccountId ?? null,
      report: merged,
      transactionPayloadCache: new Map(),
      fetchTransactionPayload: fetcher,
    })

    transactions.push(...result.transactions)
    for (const transaction of result.transactions) {
      totalUsd += transaction.amountUsd
    }
  }

  transactions.sort((left, right) => {
    const leftDate = left.date ?? ''
    const rightDate = right.date ?? ''
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
    if (left.entity !== right.entity) return left.entity.localeCompare(right.entity)
    return right.amountUsd - left.amountUsd
  })

  return {
    source: 'quickbooks',
    year: view.year,
    view,
    department: null,
    fetchedAt: new Date().toISOString(),
    mappingSource: 'data-branch',
    lineKeys: [`__account__:${accountNumber}`],
    totalUsd,
    unreconciledTotalUsd,
    accounts: [],
    transactions,
  }
}
