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
import { qbFetchReport } from '@/lib/qb/client'
import { QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'
import { enrichGlRowsWithClass } from '@/lib/qb/gl-class-enrich'
import {
  combineGlResults,
  GlNotCachedError,
  type EntityRowGroup,
  type GlDrillResult,
  type GlDrillScope,
} from '@/lib/qb/gl-combine'

// LIVE-FIRST since 2026-08: this module serves ONLY the P&L / Balance Sheet
// amount-drill modal (a human clicking one account at a time). It asks
// QuickBooks directly for the account's GL over the requested range — one
// API call per click — so the modal is always complete and current. The
// monthly GL cache the cron maintains is the FALLBACK (QB unreachable,
// token dead, account missing from the catalog), not the source of truth.
//
// History: this used to be a pure cache read, which silently served stale /
// partial data whenever the cron hadn't reached an account (chronic with
// 380+ accounts × 90+ months of specs) or a closed month was cached before
// a retroactive booking. A drill that can silently lie is worse than a
// drill that takes two seconds. The "no live QB from page requests" rule
// still stands for PAGE-LOAD paths (P&L table, BS tree, budget) — a manual
// drill click is a different traffic profile (single account, single call).
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
  // The catalog gives us the QB internal account id — required both for the
  // live GL request (QB filters by id, not number) and for matching payload
  // lines (AccountRef.value) when enriching className.
  const catalog = await readCachedAccountCatalogByNumber(entity)
  const qbAccountId = catalog.get(accountNumber)?.qbAccountId

  // Primary path: one live QB call covering the entire requested range.
  if (qbAccountId) {
    try {
      const report = await qbFetchReport(entity, 'general_ledger', {
        start_date: periodStart,
        end_date: periodEnd,
        account: qbAccountId,
        accountNumber,
      })
      const rows = parseQboGeneralLedgerRows(report as QboGeneralLedgerReport)
      return enrichGlRowsWithClass(rows, entity, qbAccountId)
    } catch {
      // QB unreachable / token dead / transient error — fall through to the
      // cached monthly reports so the drill still shows what we have.
    }
  }

  // Fallback: cached monthly reports (the pre-live behavior).
  const reports = await readCachedGeneralLedgerForAccount<QboGeneralLedgerReport>(
    entity, accountNumber, periodStart, periodEnd,
  )
  if (reports.length === 0) {
    throw new GlNotCachedError(entity, accountNumber)
  }
  const merged = mergeGeneralLedgerReports(reports)
  const rows = parseQboGeneralLedgerRows(merged)

  // Catalog miss is the legitimate "skip enrichment" path — no qbAccountId
  // means we can't safely match payload lines by id, so return raw rows.
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
