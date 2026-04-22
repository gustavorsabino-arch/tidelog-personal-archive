import 'server-only'
import { readCachedReportsInRange } from '@/lib/qb/cache-reads'
import { mergePnlTrees, parsePnlReport, type PnlTree, type QboProfitAndLossReport } from '@/lib/qb/pnl'
import type { QboEntity } from '@/lib/qb/config'

export type PnlData = PnlTree & {
  entity: string
  periodStart: string
  periodEnd: string
  fetchedAt: string
  cachedMonths: number
}

export class PnlNotCachedError extends Error {
  code = 'pnl.not_cached'
  constructor(entity: string, periodStart: string, periodEnd: string) {
    super(`No cached P&L for ${entity} between ${periodStart} and ${periodEnd}. Wait for the next fetch-qb-reports cron run.`)
  }
}

export async function getPnlData(
  entity: QboEntity,
  periodStart: string,
  periodEnd: string,
): Promise<PnlData> {
  const reports = await readCachedReportsInRange<QboProfitAndLossReport>(
    entity, 'profit_and_loss', periodStart, periodEnd,
  )

  if (reports.length === 0) {
    throw new PnlNotCachedError(entity, periodStart, periodEnd)
  }

  const tree = mergePnlTrees(reports.map(parsePnlReport))
  return {
    entity,
    periodStart,
    periodEnd,
    fetchedAt: new Date().toISOString(),
    cachedMonths: reports.length,
    ...tree,
  }
}
