import { getQboRealmId, type QboEntity } from '../qb/config.ts'

import {
  buildBudgetActualDrillTransactionsFromTransactionPayloads,
  parseBudgetActualDrillTransactions,
} from './actual-drill-model.ts'
import type { QboGeneralLedgerReport } from './actuals.ts'
import { parseQboGeneralLedgerRows } from './qb-general-ledger.ts'
import {
  fetchBudgetQboTransactionPayloadRecords,
  type BudgetQboTransactionPayloadCache,
} from './qb-transaction-payload.ts'
import type { BudgetActualDrillTransaction } from './types.ts'

type LoadBudgetActualLedgerTransactionsOptions = {
  entity: QboEntity
  accountNumber: string
  accountName: string | null
  accountId: string | null
  report: QboGeneralLedgerReport
  amountTransform?: (amountUsd: number) => number
  transactionPayloadCache?: BudgetQboTransactionPayloadCache
  fetchTransactionPayload?: (entity: QboEntity, path: string) => Promise<any>
}

export type BudgetActualLedgerTransactionsResult = {
  source: 'gl-report' | 'transaction-payload' | 'merged'
  transactions: BudgetActualDrillTransaction[]
}

function buildTransactionMergeKey(transaction: BudgetActualDrillTransaction): string {
  return [
    transaction.txnId ?? '',
    transaction.amountUsd.toFixed(2),
    (transaction.className ?? '').trim().toLowerCase(),
    transaction.normalizedDepartment ?? '',
    (transaction.documentNumber ?? '').trim().toLowerCase(),
    (transaction.date ?? '').trim().toLowerCase(),
  ].join('|')
}

function mergeLedgerAndPayloadTransactions(
  directTransactions: readonly BudgetActualDrillTransaction[],
  payloadTransactions: readonly BudgetActualDrillTransaction[],
): BudgetActualDrillTransaction[] {
  const directCounts = new Map<string, number>()
  for (const transaction of directTransactions) {
    const key = buildTransactionMergeKey(transaction)
    directCounts.set(key, (directCounts.get(key) ?? 0) + 1)
  }

  const merged = [...directTransactions]
  for (const transaction of payloadTransactions) {
    const key = buildTransactionMergeKey(transaction)
    const directCount = directCounts.get(key) ?? 0
    if (directCount > 0) {
      directCounts.set(key, directCount - 1)
      continue
    }
    merged.push(transaction)
  }

  return merged
}

export async function loadBudgetActualLedgerTransactions(
  options: LoadBudgetActualLedgerTransactionsOptions,
): Promise<BudgetActualLedgerTransactionsResult> {
  const realmId = getQboRealmId(options.entity)
  const parsedRows = parseQboGeneralLedgerRows(options.report)
  const directTransactions = parseBudgetActualDrillTransactions(options.report, {
    entity: options.entity,
    realmId,
    accountNumber: options.accountNumber,
    accountName: options.accountName,
    amountTransform: options.amountTransform,
  })

  if (!options.accountId) {
    return {
      source: 'gl-report',
      transactions: directTransactions,
    }
  }

  const payloadRecords = await fetchBudgetQboTransactionPayloadRecords({
    entity: options.entity,
    parsedRows: parsedRows.filter((row) => row.amountUsd === null),
    limit: null,
    cache: options.transactionPayloadCache,
    fetchTransactionPayload: options.fetchTransactionPayload,
  })
  const payloadTransactions = buildBudgetActualDrillTransactionsFromTransactionPayloads(
    payloadRecords,
    options.accountId,
    {
      entity: options.entity,
      realmId,
      accountNumber: options.accountNumber,
      accountName: options.accountName,
      amountTransform: options.amountTransform,
    },
  )

  if (directTransactions.length === 0 && payloadTransactions.length > 0) {
    return {
      source: 'transaction-payload',
      transactions: payloadTransactions,
    }
  }

  if (directTransactions.length > 0 && payloadTransactions.length > 0) {
    const mergedTransactions = mergeLedgerAndPayloadTransactions(directTransactions, payloadTransactions)
    return {
      source: mergedTransactions.length > directTransactions.length ? 'merged' : 'gl-report',
      transactions: mergedTransactions,
    }
  }

  if (payloadTransactions.length > 0) {
    return {
      source: 'transaction-payload',
      transactions: payloadTransactions,
    }
  }

  return {
    source: 'gl-report',
    transactions: directTransactions,
  }
}
