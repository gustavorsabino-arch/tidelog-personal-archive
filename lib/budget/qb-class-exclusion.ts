import {
  buildCachedTransactionPayloadFetcher,
  readCachedAccountCatalog,
  readCachedPerAccountGeneralLedgersInRange,
  readCachedTransactionPayloads,
} from '@/lib/qb/cache-reads'
import type { QboEntity } from '@/lib/qb/config'

import type { QboGeneralLedgerReport } from './actuals.ts'
import { parseQboGeneralLedgerRows } from './qb-general-ledger.ts'
import { isExcludedBudgetQboClassName } from './qb-class.ts'
import {
  fetchBudgetQboTransactionPayloadRecords,
  type BudgetQboTransactionPayloadRecord,
} from './qb-transaction-payload.ts'

export function applyCouncilSubtraction(
  totals: Readonly<Record<string, number>>,
  subtraction: Readonly<Record<string, number>>,
): Record<string, number> {
  const result: Record<string, number> = { ...totals }
  for (const [accountNumber, councilAmount] of Object.entries(subtraction)) {
    if (!councilAmount) continue
    result[accountNumber] = Math.max(0, (result[accountNumber] ?? 0) - councilAmount)
  }
  return result
}

export function filterExcludedClassEntries(
  classified: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [rawClass, amount] of Object.entries(classified)) {
    if (isExcludedBudgetQboClassName(rawClass)) continue
    out[rawClass] = amount
  }
  return out
}

/**
 * Pure composer: walk the per-line normalized payload records, sum the
 * amounts of every line whose class matches the Council predicate, and
 * group by accountNumber via the provided accountId→accountNumber map.
 * Lines without a resolved accountId or a finite amount are skipped.
 */
export function composeCouncilSubtractionByAccount(
  records: readonly BudgetQboTransactionPayloadRecord[],
  accountNumberById: ReadonlyMap<string, string>,
): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const record of records) {
    for (const line of record.lines) {
      if (!isExcludedBudgetQboClassName(line.className)) continue
      if (!line.accountId || line.amountUsd == null) continue
      const accountNumber = accountNumberById.get(line.accountId)
      if (!accountNumber) continue
      merged[accountNumber] = (merged[accountNumber] ?? 0) + line.amountUsd
    }
  }
  return merged
}

/**
 * Sum Council-classed amounts per accountNumber for the given entity over
 * the given range. Uses cached GL only as an index of which transactions
 * carry a Council class; the dollar amounts come from the per-transaction
 * payload cache (which carries signed line amounts and survives entities
 * whose cached GL omits the amount column, e.g. Foundation).
 */
export async function loadCouncilSubtractionByAccount(
  entity: QboEntity,
  start: string,
  end: string,
): Promise<Record<string, number>> {
  const glRows = await readCachedPerAccountGeneralLedgersInRange<QboGeneralLedgerReport>(entity, start, end)

  const councilParsedRows = []
  for (const { data } of glRows) {
    for (const parsed of parseQboGeneralLedgerRows(data)) {
      if (parsed.txnId && parsed.transactionType && isExcludedBudgetQboClassName(parsed.className)) {
        councilParsedRows.push(parsed)
      }
    }
  }

  if (councilParsedRows.length === 0) return {}

  const txnIds = Array.from(new Set(councilParsedRows.map((row) => row.txnId).filter((id): id is string => !!id)))
  const preloaded = await readCachedTransactionPayloads(entity, txnIds)
  // Cached fetcher returns `unknown`; the payload-records helper narrows it
  // internally. `qb-ledger-transactions.ts` types the same callback as
  // `Promise<any>` for the same reason — match that pattern.
  const fetcher: (entity: QboEntity, path: string) => Promise<any> =
    buildCachedTransactionPayloadFetcher(preloaded)

  const records = await fetchBudgetQboTransactionPayloadRecords({
    entity,
    parsedRows: councilParsedRows,
    fetchTransactionPayload: fetcher,
  })

  const catalog = await readCachedAccountCatalog(entity)
  const accountNumberById = new Map<string, string>()
  for (const row of catalog) {
    if (row.qbAccountNumber) accountNumberById.set(row.qbAccountId, row.qbAccountNumber)
  }

  return composeCouncilSubtractionByAccount(records, accountNumberById)
}
