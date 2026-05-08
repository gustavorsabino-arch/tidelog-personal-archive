import type { ParsedQboGeneralLedgerRow } from '@/lib/budget/qb-general-ledger'
import { type QboEntity } from '@/lib/qb/config'

export type GlDrillScope = QboEntity | 'All'

export type GlDrillRow = ParsedQboGeneralLedgerRow & {
  entity: QboEntity
}

export type GlDrillResult = {
  rows: GlDrillRow[]
  classes: string[]
  totalAmount: number
  partialEntities: QboEntity[]
  entity: GlDrillScope
  accountNumber: string
  periodStart: string
  periodEnd: string
  fetchedAt: string
}

export class GlNotCachedError extends Error {
  code = 'gl.not_cached'
  constructor(public scope: GlDrillScope, public accountNumber: string) {
    super(`No cached GL data for ${scope}/${accountNumber}. Wait for the next fetch-qb-reports cron run, or run \`bun run cron fetch-qb-reports\` locally.`)
  }
}

export function aggregateClasses(rows: readonly ParsedQboGeneralLedgerRow[]): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    if (r.className) set.add(r.className)
  }
  return [...set].sort()
}

export function tagAndSortRows(
  groups: ReadonlyArray<{ entity: QboEntity; rows: readonly ParsedQboGeneralLedgerRow[] }>,
): GlDrillRow[] {
  const tagged: GlDrillRow[] = []
  for (const g of groups) {
    for (const r of g.rows) {
      tagged.push({ ...r, entity: g.entity })
    }
  }
  tagged.sort((a, b) => a.date.localeCompare(b.date))
  return tagged
}

export type EntityRowGroup = { entity: QboEntity; rows: ParsedQboGeneralLedgerRow[] }

/**
 * Pure assembly of a GlDrillResult from per-entity load results. No I/O — kept
 * separate from gl-data.ts so it can be unit-tested without DB env.
 *
 * Inputs:
 *   - `ok`: entities that returned cached rows.
 *   - `partialEntities`: entities that returned no cached rows (cache miss).
 *
 * Throws `GlNotCachedError` if `ok` is empty (every queried entity missed).
 */
export function combineGlResults(
  scope: GlDrillScope,
  accountNumber: string,
  periodStart: string,
  periodEnd: string,
  fetchedAt: string,
  ok: readonly EntityRowGroup[],
  partialEntities: readonly QboEntity[],
): GlDrillResult {
  if (ok.length === 0) {
    throw new GlNotCachedError(scope, accountNumber)
  }
  const rows = tagAndSortRows(ok)
  const classes = aggregateClasses(rows)
  const totalAmount = rows.reduce((acc, r) => acc + (r.amountUsd ?? 0), 0)
  return {
    rows, classes, totalAmount,
    partialEntities: [...partialEntities],
    entity: scope, accountNumber, periodStart, periodEnd, fetchedAt,
  }
}
