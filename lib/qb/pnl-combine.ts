import { mergePnlTrees, type PnlTree } from '@/lib/qb/pnl'
import { type QboEntity } from '@/lib/qb/config'

export type PnlDataScope = QboEntity | 'All'

export type PnlData = PnlTree & {
  entity: PnlDataScope
  periodStart: string
  periodEnd: string
  fetchedAt: string
  cachedMonths: number
  partialEntities: QboEntity[]
}

export class PnlNotCachedError extends Error {
  code = 'pnl.not_cached'
  constructor(scope: PnlDataScope, periodStart: string, periodEnd: string) {
    super(`No cached P&L for ${scope} between ${periodStart} and ${periodEnd}. Wait for the next fetch-qb-reports cron run.`)
  }
}

export type EntityLoadResult = {
  entity: QboEntity
  tree: PnlTree | null
  cachedMonths: number
}

/**
 * Pure combiner for per-entity P&L load results. Performs no I/O so it can be
 * unit-tested without touching the database.
 *
 * Behaviour:
 * - All entities with `tree: null` collected into `partialEntities`.
 * - If every result has `tree: null`, throws `PnlNotCachedError`.
 * - Remaining trees are summed via `mergePnlTrees`; `cachedMonths` sums only
 *   the present entities.
 * - For single-entity scopes the input is a one-element array; the same
 *   collapse-or-throw rules apply, and `partialEntities` will always be empty
 *   on success because the only entity is the scope itself.
 */
export function combineEntityResults(
  results: readonly EntityLoadResult[],
  scope: PnlDataScope,
  periodStart: string,
  periodEnd: string,
  fetchedAt: string,
): PnlData {
  const present = results.filter((r) => r.tree !== null)
  if (present.length === 0) {
    throw new PnlNotCachedError(scope, periodStart, periodEnd)
  }
  const merged = mergePnlTrees(present.map((r) => r.tree as PnlTree))
  const partialEntities = results.filter((r) => r.tree === null).map((r) => r.entity)
  const cachedMonths = present.reduce((acc, r) => acc + r.cachedMonths, 0)
  return {
    entity: scope,
    periodStart,
    periodEnd,
    fetchedAt,
    cachedMonths,
    partialEntities,
    ...merged,
  }
}
