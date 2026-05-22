/**
 * Cache-only readers for QuickBooks data.
 *
 * Every consumer in the budget / accounting code must read from here — no
 * direct `fetchQboJson` calls inside request handlers. Live QB fetches are
 * the sole responsibility of the fetch-qb-reports cron; the app reads what
 * the cron has stored.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import {
  qbAccountCatalog,
  qbReportCache,
  qbTransactionCache,
} from '@/lib/db/schema/quickbooks'
import { type QboEntity } from './config'

type QbReportType = 'balance_sheet' | 'profit_and_loss' | 'general_ledger'

function entityToId(entity: QboEntity): string {
  return entity.toLowerCase()
}

async function readReport<T>(
  entity: QboEntity,
  reportType: QbReportType,
  periodStart: string,
  periodEnd: string,
): Promise<T | null> {
  const [row] = await db.select()
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityToId(entity)),
      eq(qbReportCache.reportType, reportType),
      eq(qbReportCache.periodStart, periodStart),
      eq(qbReportCache.periodEnd, periodEnd),
    ))
    .orderBy(asc(qbReportCache.fetchedAt))
    .limit(1)
  return row ? (row.data as T) : null
}

export async function readCachedProfitAndLoss<T>(
  entity: QboEntity,
  periodStart: string,
  periodEnd: string,
): Promise<T | null> {
  return readReport<T>(entity, 'profit_and_loss', periodStart, periodEnd)
}

export async function readCachedBalanceSheet<T>(
  entity: QboEntity,
  asOfDate: string,
): Promise<{ data: T; fetchedAt: Date } | null> {
  const [row] = await db.select({
    data: qbReportCache.data,
    fetchedAt: qbReportCache.fetchedAt,
  })
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityToId(entity)),
      eq(qbReportCache.reportType, 'balance_sheet'),
      eq(qbReportCache.periodStart, asOfDate),
      eq(qbReportCache.periodEnd, asOfDate),
    ))
    .orderBy(desc(qbReportCache.fetchedAt))
    .limit(1)
  return row ? { data: row.data as T, fetchedAt: row.fetchedAt } : null
}

/**
 * Return the most recent cached balance_sheet whose periodEnd is on or before
 * asOfDate. The cron stores one row per month-end plus a rolling "today" row,
 * so an exact match won't always exist — callers can use this to fall back to
 * the nearest earlier snapshot.
 */
export async function readLatestCachedBalanceSheetOnOrBefore<T>(
  entity: QboEntity,
  asOfDate: string,
): Promise<{ data: T; asOfDate: string; fetchedAt: Date } | null> {
  const [row] = await db.select({
    data: qbReportCache.data,
    periodEnd: qbReportCache.periodEnd,
    fetchedAt: qbReportCache.fetchedAt,
  })
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityToId(entity)),
      eq(qbReportCache.reportType, 'balance_sheet'),
      lte(qbReportCache.periodEnd, asOfDate),
    ))
    .orderBy(desc(qbReportCache.periodEnd), desc(qbReportCache.fetchedAt))
    .limit(1)
  return row ? { data: row.data as T, asOfDate: row.periodEnd, fetchedAt: row.fetchedAt } : null
}

/**
 * Returns whichever GL cache row exists for (entity, periodStart, periodEnd).
 * The cron writes a single row per month containing every mapped account,
 * regardless of filter_params, so we don't filter by filter_params here.
 */
export async function readCachedGeneralLedger<T>(
  entity: QboEntity,
  periodStart: string,
  periodEnd: string,
): Promise<T | null> {
  return readReport<T>(entity, 'general_ledger', periodStart, periodEnd)
}

/**
 * Return every cached report of the given type whose period is fully inside
 * [periodStart, periodEnd]. The cron writes one row per calendar month, so a
 * YTD / annual range read is composed by loading the month rows and letting
 * the caller aggregate.
 */
/**
 * Distinct years that have at least one cached report of the given type.
 * Used by UIs (e.g. P&L year picker) to populate dropdowns from real data
 * rather than a hardcoded range.
 */
export async function getCachedReportYears(reportType: QbReportType): Promise<number[]> {
  const rows = await db.execute<{ year: number }>(
    sql`SELECT DISTINCT EXTRACT(YEAR FROM ${qbReportCache.periodStart})::int AS year
        FROM ${qbReportCache}
        WHERE ${qbReportCache.reportType} = ${reportType}
        ORDER BY year DESC`,
  )
  // drizzle returns rows as an array-like; normalise then sort defensively.
  return Array.from(rows as unknown as { year: number }[])
    .map((row) => row.year)
    .filter((year): year is number => Number.isInteger(year))
    .sort((a, b) => a - b)
}

export async function readCachedReportsInRange<T>(
  entity: QboEntity,
  reportType: QbReportType,
  periodStart: string,
  periodEnd: string,
): Promise<T[]> {
  const rows = await db.select({ data: qbReportCache.data })
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityToId(entity)),
      eq(qbReportCache.reportType, reportType),
      gte(qbReportCache.periodStart, periodStart),
      lte(qbReportCache.periodEnd, periodEnd),
    ))
    .orderBy(asc(qbReportCache.periodStart))
  return rows.map((row) => row.data as T)
}

/**
 * Same as readCachedReportsInRange, but exposes each row's periodStart so the
 * caller can group results by month instead of aggregating across the range.
 */
export async function readCachedReportsInRangeWithPeriod<T>(
  entity: QboEntity,
  reportType: QbReportType,
  periodStart: string,
  periodEnd: string,
): Promise<{ periodStart: string; periodEnd: string; data: T }[]> {
  const rows = await db.select({
    periodStart: qbReportCache.periodStart,
    periodEnd: qbReportCache.periodEnd,
    data: qbReportCache.data,
  })
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityToId(entity)),
      eq(qbReportCache.reportType, reportType),
      gte(qbReportCache.periodStart, periodStart),
      lte(qbReportCache.periodEnd, periodEnd),
    ))
    .orderBy(asc(qbReportCache.periodStart))
  return rows.map((row) => ({
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    data: row.data as T,
  }))
}

/**
 * Return cached per-account GL reports for a specific account number across
 * the given range. The cron writes one row per (entity, account, month) with
 * filterParams = { account, accountNumber }; we filter by accountNumber so
 * callers don't need the QB internal ID.
 */
export async function readCachedGeneralLedgerForAccount<T>(
  entity: QboEntity,
  accountNumber: string,
  periodStart: string,
  periodEnd: string,
): Promise<T[]> {
  const rows = await db.select({
    data: qbReportCache.data,
    filterParams: qbReportCache.filterParams,
  })
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityToId(entity)),
      eq(qbReportCache.reportType, 'general_ledger'),
      gte(qbReportCache.periodStart, periodStart),
      lte(qbReportCache.periodEnd, periodEnd),
    ))
    .orderBy(asc(qbReportCache.periodStart))
  return rows
    .filter((row) => (row.filterParams as { accountNumber?: string } | null)?.accountNumber === accountNumber)
    .map((row) => row.data as T)
}

export type CachedAccount = {
  qbAccountId: string
  qbAccountNumber: string | null
  qbAccountName: string
  accountType: string | null
}

export async function readCachedAccountCatalog(entity: QboEntity): Promise<CachedAccount[]> {
  return db.select({
    qbAccountId: qbAccountCatalog.qbAccountId,
    qbAccountNumber: qbAccountCatalog.qbAccountNumber,
    qbAccountName: qbAccountCatalog.qbAccountName,
    accountType: qbAccountCatalog.accountType,
  }).from(qbAccountCatalog).where(eq(qbAccountCatalog.entityId, entityToId(entity)))
}

/**
 * Returns a Map<accountNumber → CachedAccount>. Accounts without a number
 * (rare — mostly special QB subaccounts) are omitted.
 */
export async function readCachedAccountCatalogByNumber(
  entity: QboEntity,
): Promise<Map<string, CachedAccount>> {
  const rows = await readCachedAccountCatalog(entity)
  const byNumber = new Map<string, CachedAccount>()
  for (const row of rows) {
    if (!row.qbAccountNumber) continue
    byNumber.set(row.qbAccountNumber, row)
  }
  return byNumber
}

export type CachedTransactionPayload<T = unknown> = {
  txnId: string
  resourceType: string
  payload: T
  fetchedAt: Date
}

/**
 * A failure-marker row stored in qb_transaction_cache when QB returns a
 * permanent 4xx for a txn payload fetch. Consumers must treat these as
 * "not in cache" so the GL row is still rendered (without payload enrichment)
 * and the cron's negative cache stops re-attempting the request every hour.
 */
function isFailureMarker(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null
    && (payload as { _failed?: unknown })._failed === true
}

export async function readCachedTransactionPayloads<T = unknown>(
  entity: QboEntity,
  txnIds: readonly string[],
): Promise<Map<string, CachedTransactionPayload<T>>> {
  if (txnIds.length === 0) return new Map()
  const rows = await db.select()
    .from(qbTransactionCache)
    .where(and(
      eq(qbTransactionCache.entityId, entityToId(entity)),
      inArray(qbTransactionCache.txnId, [...txnIds]),
    ))

  const map = new Map<string, CachedTransactionPayload<T>>()
  for (const row of rows) {
    if (isFailureMarker(row.payload)) continue
    map.set(row.txnId, {
      txnId: row.txnId,
      resourceType: row.resourceType,
      payload: row.payload as T,
      fetchedAt: row.fetchedAt,
    })
  }
  return map
}

/**
 * Build a drop-in replacement for `fetchQboJson(entity, path)` when the only
 * paths being fetched are per-transaction GET endpoints of the form
 * `/v3/company/<realm>/<resource>/<txnId>?...`. Reads from qb_transaction_cache.
 * Throws on cache miss, which consumers treat as "skip this row".
 */
export function buildCachedTransactionPayloadFetcher(
  preloaded?: Map<string, CachedTransactionPayload<unknown>>,
) {
  return async function fetchCached(entity: QboEntity, path: string): Promise<unknown> {
    const match = path.match(/\/v3\/company\/[^/]+\/([^/]+)\/([^/?]+)/)
    if (!match) {
      throw new Error(`cache-reads: unrecognized QB path "${path}"`)
    }
    const [, , encodedTxnId] = match
    const txnId = decodeURIComponent(encodedTxnId)
    if (preloaded?.has(txnId)) {
      return preloaded.get(txnId)!.payload
    }
    const map = await readCachedTransactionPayloads(entity, [txnId])
    const record = map.get(txnId)
    if (!record) {
      throw new Error(`qb_transaction_cache miss for ${entity}/${txnId}`)
    }
    return record.payload
  }
}
