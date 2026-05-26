import type { CachedTransactionPayload } from '../qb/cache-reads.ts'
import { getQboRealmId, type QboEntity } from '../qb/config.ts'
import { enrichGlRowsWithClass } from '../qb/gl-class-enrich.ts'
import { enrichGlRowsWithName } from '../qb/gl-name-enrich.ts'

import {
  buildBudgetActualDrillTransactionsFromLedgerRows,
  buildBudgetActualDrillTransactionsFromTransactionPayloads,
} from './actual-drill-model.ts'
import type { QboGeneralLedgerReport } from './actuals.ts'
import { parseQboGeneralLedgerRows, type ParsedQboGeneralLedgerRow } from './qb-general-ledger.ts'
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
  // Required so no code path here can trigger a live QuickBooks call. Wire in
  // a cache-backed fetcher (see lib/qb/cache-reads.ts#buildCachedTransactionPayloadFetcher).
  fetchTransactionPayload: (entity: QboEntity, path: string) => Promise<any>
  // Optional preloaded transaction payload map keyed by txnId. When provided,
  // class enrichment uses it directly instead of issuing a fresh DB query per
  // account-task. Critical for performance on department-actuals fan-out:
  // see lib/budget/qb-department-actuals.ts which preloads once per entity.
  preloadedPayloadMap?: ReadonlyMap<string, CachedTransactionPayload>
  // Optional already-parsed rows for `report`. When the caller has already
  // parsed (e.g. department-actuals does so once to collect txnIds for the
  // payload preload), passing them here avoids parsing the same JSON twice.
  preParsedRows?: readonly ParsedQboGeneralLedgerRow[]
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
  // Reuse pre-parsed rows when the caller has them. Otherwise parse here.
  // (Department-actuals parses once to collect txnIds for the payload
  // preload; without this hint we'd parse the same JSON twice.)
  const parsedRows = options.preParsedRows ?? parseQboGeneralLedgerRows(options.report)

  // Enrich the parsed rows with class data from cached transaction payloads
  // before building drill transactions. QB's default GL response doesn't
  // include klass_name, so without this every row's `className` is null,
  // which collapses every dollar into the unclassified bucket and leaves
  // department views blank.
  //
  // Fail-open: a cache read failure (e.g. running in a test without a DB)
  // returns the parsed rows unchanged, preserving today's behavior.
  const classEnrichedRows = options.accountId
    ? await enrichGlRowsWithClass(parsedRows, options.entity, options.accountId, {
        payloadMap: options.preloadedPayloadMap,
      })
    : parsedRows

  // Then enrich `name` from the cached payload — QB GL doesn't reliably
  // populate the Name column for JEs (per-line Entity.EntityRef.name lives
  // on the JE body) or for Bills (vendor lives at VendorRef.name on the
  // body). Reuses the same payloadMap so no extra DB roundtrip.
  const enrichedRows = options.accountId
    ? await enrichGlRowsWithName(classEnrichedRows, options.entity, options.accountId, {
        payloadMap: options.preloadedPayloadMap,
      })
    : classEnrichedRows

  const directTransactions = buildBudgetActualDrillTransactionsFromLedgerRows(enrichedRows, {
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
