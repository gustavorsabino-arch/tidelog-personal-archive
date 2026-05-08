import 'server-only'
import { readCachedReportsInRange } from '@/lib/qb/cache-reads'
import { mergePnlTrees, parsePnlReport, type PnlTree, type QboProfitAndLossReport } from '@/lib/qb/pnl'
import { QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'
import {
  combineEntityResults,
  PnlNotCachedError,
  type EntityLoadResult,
  type PnlData,
  type PnlDataScope,
} from '@/lib/qb/pnl-combine'

// Re-export the public surface so existing callers of `pnl-data.ts` keep working.
export { PnlNotCachedError }
export type { PnlData, PnlDataScope }

async function loadEntityTree(
  entity: QboEntity,
  periodStart: string,
  periodEnd: string,
): Promise<EntityLoadResult> {
  const reports = await readCachedReportsInRange<QboProfitAndLossReport>(
    entity, 'profit_and_loss', periodStart, periodEnd,
  )
  if (reports.length === 0) {
    return { entity, tree: null, cachedMonths: 0 }
  }
  const tree = mergePnlTrees(reports.map(parsePnlReport))
  return { entity, tree, cachedMonths: reports.length }
}

export async function getPnlData(
  scope: PnlDataScope,
  periodStart: string,
  periodEnd: string,
): Promise<PnlData> {
  const fetchedAt = new Date().toISOString()
  if (scope === 'All') {
    const results = await Promise.all(
      QBO_ENTITIES.map((e) => loadEntityTree(e, periodStart, periodEnd)),
    )
    return combineEntityResults(results, scope, periodStart, periodEnd, fetchedAt)
  }

  const result = await loadEntityTree(scope, periodStart, periodEnd)
  return combineEntityResults([result], scope, periodStart, periodEnd, fetchedAt)
}
