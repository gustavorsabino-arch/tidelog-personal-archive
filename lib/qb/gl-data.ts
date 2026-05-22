import 'server-only'
import {
  mergeGeneralLedgerReports,
  type QboGeneralLedgerReport,
} from '@/lib/budget/actuals'
import {
  parseQboGeneralLedgerRows,
  type ParsedQboGeneralLedgerRow,
} from '@/lib/budget/qb-general-ledger'
import {
  readCachedAccountCatalogByNumber,
  readCachedGeneralLedgerForAccount,
} from '@/lib/qb/cache-reads'
import { QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'
import { enrichGlRowsWithClass } from '@/lib/qb/gl-class-enrich'
import {
  combineGlResults,
  GlNotCachedError,
  type EntityRowGroup,
  type GlDrillResult,
  type GlDrillScope,
} from '@/lib/qb/gl-combine'

// NOTE: this module is a pure cache-read. It must NOT import qbFetchReport,
// fetchQboJson, or any other live-QB helper. Live fetches are the cron's
// exclusive responsibility (see lib/qb/cache-reads.ts:1-8 for the canonical
// statement of this contract).
//
// For Class filter UI, use the per-row `className` field on the rows below;
// `parseQboGeneralLedgerByClass` in lib/budget/actuals.ts is for budget
// allocation totals only and is not the right tool for this drill-down.

// Re-export the public surface so existing callers of `gl-data.ts` keep working.
export { GlNotCachedError }
export type { GlDrillResult, GlDrillScope, GlDrillRow } from '@/lib/qb/gl-combine'

async function loadEntity(
  entity: QboEntity,
  accountNumber: string,
  periodStart: string,
  periodEnd: string,
): Promise<ParsedQboGeneralLedgerRow[]> {
  // Fetch GL + account catalog in parallel — the catalog gives us the QB
  // internal account id, which is the key we use to match payload lines
  // (AccountRef.value) when enriching className from qb_transaction_cache.
  const [reports, catalog] = await Promise.all([
    readCachedGeneralLedgerForAccount<QboGeneralLedgerReport>(
      entity, accountNumber, periodStart, periodEnd,
    ),
    readCachedAccountCatalogByNumber(entity),
  ])
  if (reports.length === 0) {
    throw new GlNotCachedError(entity, accountNumber)
  }
  const merged = mergeGeneralLedgerReports(reports)
  const rows = parseQboGeneralLedgerRows(merged)

  // Catalog miss is the legitimate "skip enrichment" path — no qbAccountId
  // means we can't safely match payload lines by id, so return raw rows.
  // Same behavior as pre-fix; drawer just won't show the class column.
  const qbAccountId = catalog.get(accountNumber)?.qbAccountId
  if (!qbAccountId) return rows
  return enrichGlRowsWithClass(rows, entity, qbAccountId)
}

export async function getGlForAccount(
  scope: GlDrillScope,
  accountNumber: string,
  periodStart: string,
  periodEnd: string,
): Promise<GlDrillResult> {
  const fetchedAt = new Date().toISOString()
  const entities: readonly QboEntity[] = scope === 'All' ? QBO_ENTITIES : [scope]

  const settled = await Promise.allSettled(
    entities.map(async (e) => ({
      entity: e,
      rows: await loadEntity(e, accountNumber, periodStart, periodEnd),
    })),
  )

  const ok: EntityRowGroup[] = []
  const partialEntities: QboEntity[] = []
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]
    const e = entities[i]
    if (s.status === 'fulfilled') {
      ok.push(s.value)
    } else if (s.reason instanceof GlNotCachedError) {
      partialEntities.push(e)
    } else {
      // Unexpected error — surface it. Don't silently swallow.
      throw s.reason
    }
  }

  return combineGlResults(scope, accountNumber, periodStart, periodEnd, fetchedAt, ok, partialEntities)
}
