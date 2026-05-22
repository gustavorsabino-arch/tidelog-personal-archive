import 'server-only'

import {
  readCachedTransactionPayloads,
  type CachedTransactionPayload,
} from '@/lib/qb/cache-reads'
import { type QboEntity } from '@/lib/qb/config'
import { type ParsedQboGeneralLedgerRow } from '@/lib/budget/qb-general-ledger'
import { enrichRowsWithClassFromPayloads } from '@/lib/qb/gl-class-match'

// Re-export the pure helper so existing import sites keep working.
export { enrichRowsWithClassFromPayloads }

/**
 * Async wrapper: collects distinct txnIds from `rows`, bulk-loads payloads
 * from qb_transaction_cache, then delegates to the pure enrichment helper
 * in `./gl-class-match`. On cache-read error, returns rows unchanged
 * (fail-open — the drawer still shows what it would have shown without
 * enrichment).
 *
 * Performance note: callers that already preloaded payloads (e.g.
 * `qb-department-actuals.ts` builds an entity-wide payload map up front
 * for amount-backfill) MUST pass it via `opts.payloadMap`. Without it,
 * this function re-queries the DB once per account-task — which on
 * `entity=All` department views is ~300+ redundant roundtrips per
 * request and made the page take many seconds to switch departments.
 */
export async function enrichGlRowsWithClass(
  rows: readonly ParsedQboGeneralLedgerRow[],
  entity: QboEntity,
  qbAccountId: string,
  opts?: { payloadMap?: ReadonlyMap<string, CachedTransactionPayload> },
): Promise<ParsedQboGeneralLedgerRow[]> {
  // Fast path: caller already has the payloads in memory — skip DB entirely.
  if (opts?.payloadMap) {
    return enrichRowsWithClassFromPayloads(rows, qbAccountId, opts.payloadMap)
  }

  const txnIds = Array.from(
    new Set(rows.filter((r) => !r.className && r.txnId).map((r) => r.txnId!)),
  )
  if (txnIds.length === 0) return rows.map((r) => ({ ...r }))

  let payloadMap: Map<string, CachedTransactionPayload>
  try {
    payloadMap = await readCachedTransactionPayloads(entity, txnIds)
  } catch (err) {
    console.warn(
      `[gl-class-enrich] readCachedTransactionPayloads failed for ${entity}:`,
      err,
    )
    return rows.map((r) => ({ ...r }))
  }

  return enrichRowsWithClassFromPayloads(rows, qbAccountId, payloadMap)
}
