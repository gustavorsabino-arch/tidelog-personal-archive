import 'server-only'

import {
  readCachedTransactionPayloads,
  type CachedTransactionPayload,
} from '@/lib/qb/cache-reads'
import { type QboEntity } from '@/lib/qb/config'
import { type ParsedQboGeneralLedgerRow } from '@/lib/budget/qb-general-ledger'
import { enrichRowsWithNameFromPayloads } from '@/lib/qb/gl-name-match'

export { enrichRowsWithNameFromPayloads }

/**
 * Async wrapper around `enrichRowsWithNameFromPayloads`: collects distinct
 * txnIds, bulk-loads cached payloads, then delegates. Mirrors the shape of
 * `enrichGlRowsWithClass` so callers can preload a payload map once and
 * reuse it for both class and name enrichment.
 */
export async function enrichGlRowsWithName(
  rows: readonly ParsedQboGeneralLedgerRow[],
  entity: QboEntity,
  qbAccountId: string,
  opts?: { payloadMap?: ReadonlyMap<string, CachedTransactionPayload> },
): Promise<ParsedQboGeneralLedgerRow[]> {
  if (opts?.payloadMap) {
    return enrichRowsWithNameFromPayloads(rows, qbAccountId, opts.payloadMap)
  }

  const txnIds = Array.from(
    new Set(rows.filter((r) => r.txnId).map((r) => r.txnId!)),
  )
  if (txnIds.length === 0) return rows.map((r) => ({ ...r }))

  let payloadMap: Map<string, CachedTransactionPayload>
  try {
    payloadMap = await readCachedTransactionPayloads(entity, txnIds)
  } catch (err) {
    console.warn(
      `[gl-name-enrich] readCachedTransactionPayloads failed for ${entity}:`,
      err,
    )
    return rows.map((r) => ({ ...r }))
  }

  return enrichRowsWithNameFromPayloads(rows, qbAccountId, payloadMap)
}
