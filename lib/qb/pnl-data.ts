import 'server-only'
import { readCachedReportsInRange } from '@/lib/qb/cache-reads'
import { mergePnlTrees, parsePnlReport, type PnlTree, type QboProfitAndLossReport } from '@/lib/qb/pnl'
import { QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'

export type PnlDataScope = QboEntity | 'All'

export type PnlData = PnlTree & {
  entity: PnlDataScope
  periodStart: string
  periodEnd: string
  fetchedAt: string
  cachedMonths: number
  partialEntities: string[]
}

export class PnlNotCachedError extends Error {
  code = 'pnl.not_cached'
  constructor(scope: PnlDataScope, periodStart: string, periodEnd: string) {
    super(`No cached P&L for ${scope} between ${periodStart} and ${periodEnd}. Wait for the next fetch-qb-reports cron run.`)
  }
}

async function loadEntityTree(
  entity: QboEntity,
  periodStart: string,
  periodEnd: string,
): Promise<{ entity: QboEntity; tree: PnlTree | null; cachedMonths: number }> {
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
  if (scope === 'All') {
    const results = await Promise.all(
      QBO_ENTITIES.map((e) => loadEntityTree(e, periodStart, periodEnd)),
    )
    const present = results.filter((r) => r.tree !== null)
    if (present.length === 0) {
      throw new PnlNotCachedError(scope, periodStart, periodEnd)
    }
    const merged = mergePnlTrees(present.map((r) => r.tree!))
    const partialEntities = results.filter((r) => r.tree === null).map((r) => r.entity)
    const cachedMonths = present.reduce((acc, r) => acc + r.cachedMonths, 0)
    return {
      entity: scope,
      periodStart,
      periodEnd,
      fetchedAt: new Date().toISOString(),
      cachedMonths,
      partialEntities,
      ...merged,
    }
  }

  const { tree, cachedMonths } = await loadEntityTree(scope, periodStart, periodEnd)
  if (!tree) {
    throw new PnlNotCachedError(scope, periodStart, periodEnd)
  }
  return {
    entity: scope,
    periodStart,
    periodEnd,
    fetchedAt: new Date().toISOString(),
    cachedMonths,
    partialEntities: [],
    ...tree,
  }
}
