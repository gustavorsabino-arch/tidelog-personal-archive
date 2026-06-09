import { and, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  qbAccountCatalog,
  qbConnection,
  qbReportCache,
  qbTransactionCache,
  budgetQbMapping,
} from '@/lib/db/schema'
import { QboHttpError, fetchQboJson, qbFetchReport, type QbReportType } from '@/lib/qb/client'
import { getQboRealmId, isQboEntity, type QboEntity } from '@/lib/qb/config'
import { buildGlAccountList } from './gl-account-list.ts'

/**
 * How long to trust a non-closed (moving-window or current-month) cache row
 * before re-fetching. Closed-month rows are never re-fetched once cached.
 */
const CACHE_STALE_MS = 48 * 60 * 60 * 1000

/**
 * How long we trust the account catalog before refreshing. Accounts rarely
 * change; 24h is a good balance.
 */
const ACCOUNT_CATALOG_STALE_MS = 24 * 60 * 60 * 1000

/** Parallel QB requests per entity for transaction payload backfill. */
const TRANSACTION_PAYLOAD_CONCURRENCY = 6

/**
 * Wall-clock budget for a single payload-backfill pass. Vercel kills the
 * function at 300s; budget for 240s so we exit cleanly and the report
 * sections that already ran get committed. Remaining txn payloads pick up
 * on the next run.
 */
const PAYLOAD_BACKFILL_BUDGET_MS = 240_000

/**
 * How long to trust a failure marker before re-attempting the fetch. Most
 * 4xx failures are deletions and will keep failing forever, but a transient
 * 400 (auth glitch, brief QB outage) shouldn't permanently suppress a real
 * txn. Re-attempting after 7 days gives a self-healing path without needing
 * a manual force-refresh.
 */
const FAILURE_MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Earliest year QB-cached reports go back to. Closed months before this are
 * never fetched. The default (2019) is intentionally generous — covers the
 * earliest known activity across entities (Opco's books start in 2019). Note:
 * this is the QB-data floor only; the budget page enforces its own
 * `MIN_BUDGET_YEAR` (lib/budget/scope.ts) independently. Override per-env via
 * QB_HISTORY_START_YEAR if needed.
 */
const HISTORY_START_YEAR = Number(process.env.QB_HISTORY_START_YEAR || '2019')

type ReportSpec = {
  reportType: QbReportType
  periodStart: string
  periodEnd: string
  filterParams: Record<string, unknown>
  /**
   * Closed months never change — once we have a cache row for one, skip it
   * forever. The current month and moving windows (YTD, BS-as-of-today) get
   * re-fetched subject to CACHE_STALE_MS.
   */
  isClosed: boolean
}

/**
 * Which GL accounts the run is responsible for.
 * - 'pnl-typed': all P&L-typed accounts + budget-mapped (default — powers
 *   the P&L drill on /pnl). Used by the daily cron.
 * - 'budget-mapped': budget-mapped accounts only. Used by force-refresh so
 *   a finance-triggered refresh stays under Vercel's 800s budget; non-budget
 *   P&L accounts continue to be refreshed by the daily cron.
 */
export type QbAccountScope = 'pnl-typed' | 'budget-mapped'

type MonthRange = { periodStart: string; periodEnd: string; isClosed: boolean }

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Enumerate every month from HISTORY_START_YEAR-01 up through the current
 * month, marking months that have fully elapsed as closed.
 */
function enumerateMonths(now: Date = new Date()): MonthRange[] {
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() // 0-indexed
  const firstOfThisMonth = new Date(Date.UTC(currentYear, currentMonth, 1))

  const months: MonthRange[] = []
  for (let year = HISTORY_START_YEAR; year <= currentYear; year++) {
    const lastMonthInYear = year === currentYear ? currentMonth : 11
    for (let month = 0; month <= lastMonthInYear; month++) {
      const start = new Date(Date.UTC(year, month, 1))
      const end = new Date(Date.UTC(year, month + 1, 0))
      months.push({
        periodStart: iso(start),
        periodEnd: iso(end),
        isClosed: end.getTime() < firstOfThisMonth.getTime(),
      })
    }
  }
  return months
}

function entityIdToQboEntity(id: string): QboEntity | null {
  const cap = id.charAt(0).toUpperCase() + id.slice(1).toLowerCase()
  return isQboEntity(cap) ? cap : null
}

async function buildSpecsForEntity(
  entityId: string,
  now: Date = new Date(),
  accountScope: QbAccountScope = 'pnl-typed',
): Promise<ReportSpec[]> {
  const months = enumerateMonths(now)
  const today = iso(now)

  const specs: ReportSpec[] = []

  for (const m of months) {
    specs.push({
      reportType: 'balance_sheet',
      periodStart: m.periodEnd,
      periodEnd: m.periodEnd,
      filterParams: {},
      isClosed: m.isClosed,
    })
    specs.push({
      reportType: 'profit_and_loss',
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
      filterParams: {},
      isClosed: m.isClosed,
    })
  }

  specs.push({
    reportType: 'balance_sheet',
    periodStart: today,
    periodEnd: today,
    filterParams: {},
    isClosed: false,
  })

  // GL: one request per account per month for both budget-mapped accounts and
  // every P&L-typed account in the catalog. The latter powers the P&L drill-
  // down on the page; closed-month idempotence keeps subsequent runs cheap.
  const mappings = await db.select({ acct: budgetQbMapping.qbAccountNumber }).from(budgetQbMapping)
  const budgetAccountNumbers = Array.from(new Set(mappings.map((m) => m.acct))).sort()

  const catalog = await db.select({
    accountNumber: qbAccountCatalog.qbAccountNumber,
    accountId: qbAccountCatalog.qbAccountId,
    accountType: qbAccountCatalog.accountType,
  }).from(qbAccountCatalog).where(eq(qbAccountCatalog.entityId, entityId))

  const allAccounts = buildGlAccountList(budgetAccountNumbers, catalog)
  const accounts = accountScope === 'budget-mapped'
    ? allAccounts.filter((a) => new Set(budgetAccountNumbers).has(a.accountNumber))
    : allAccounts
  if (accounts.length === 0) return specs

  for (const { accountNumber, accountId } of accounts) {
    for (const m of months) {
      specs.push({
        reportType: 'general_ledger',
        periodStart: m.periodStart,
        periodEnd: m.periodEnd,
        // `account` matches QB's param; `accountNumber` is here for cache
        // lookups on the read side — we usually only have the number, not
        // the QB-internal ID, when querying the cache from the app.
        filterParams: { account: accountId, accountNumber },
        isClosed: m.isClosed,
      })
    }
  }

  return specs
}

// ─────────────────────────────────────────────────────────────────────────
// Account catalog refresh
// ─────────────────────────────────────────────────────────────────────────

type QboAccountQueryResponse = {
  QueryResponse?: {
    Account?: Array<{
      Id?: string
      Name?: string
      AcctNum?: string
      AccountType?: string
    }>
  }
}

async function refreshAccountCatalog(entity: QboEntity, entityId: string, now: Date): Promise<void> {
  const [fresh] = await db.select({ fetchedAt: qbAccountCatalog.fetchedAt })
    .from(qbAccountCatalog).where(eq(qbAccountCatalog.entityId, entityId))
    .orderBy(qbAccountCatalog.fetchedAt).limit(1)
  if (fresh && now.getTime() - fresh.fetchedAt.getTime() < ACCOUNT_CATALOG_STALE_MS) {
    console.log(`[qb-reports] ${entityId}: account catalog fresh, skipping`); return
  }
  await fetchAndStoreAccountCatalog(entity, entityId, now)
}

// Force-fetch QB Chart of Accounts and replace the entity's catalog rows. No
// staleness guard — the cron uses refreshAccountCatalog; the route uses this.
export async function fetchAndStoreAccountCatalog(entity: QboEntity, entityId: string, now: Date): Promise<number> {
  console.log(`[qb-reports] ${entityId}: refreshing account catalog…`)
  const realmId = getQboRealmId(entity)
  const path = `/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent('SELECT * FROM Account MAXRESULTS 1000')}&minorversion=65`
  const response = await fetchQboJson<QboAccountQueryResponse>(entity, path)
  const accounts = response.QueryResponse?.Account ?? []
  if (accounts.length === 0) { console.log(`[qb-reports] ${entityId}: account catalog empty`); return 0 }
  const values = accounts.filter((a) => a.Id && a.Name).map((a) => ({
    entityId, qbAccountId: String(a.Id), qbAccountNumber: a.AcctNum ? String(a.AcctNum) : null,
    qbAccountName: String(a.Name), accountType: a.AccountType ? String(a.AccountType) : null, fetchedAt: now,
  }))
  if (values.length === 0) return 0
  await db.transaction(async (tx) => {
    await tx.delete(qbAccountCatalog).where(eq(qbAccountCatalog.entityId, entityId))
    await tx.insert(qbAccountCatalog).values(values)
  })
  console.log(`[qb-reports] ${entityId}: account catalog saved (${values.length} accounts)`)
  return values.length
}

// ─────────────────────────────────────────────────────────────────────────
// Transaction payload backfill
// ─────────────────────────────────────────────────────────────────────────

type GlRowLike = {
  type?: string
  ColData?: Array<{ value?: string; id?: string }>
  Rows?: { Row?: GlRowLike[] }
}

type GlReportLike = {
  Rows?: { Row?: GlRowLike[] }
}

function extractTxnRefsFromGl(report: GlReportLike): Array<{ txnId: string; transactionType: string }> {
  const out: Array<{ txnId: string; transactionType: string }> = []
  const seen = new Set<string>()

  function walk(rows: GlRowLike[] | undefined) {
    if (!rows) return
    for (const row of rows) {
      if (row.type === 'Data' && row.ColData) {
        const txnType = (row.ColData[1]?.value ?? '').trim()
        const txnId = (row.ColData[1]?.id ?? '').trim()
        if (txnType && txnId && !seen.has(txnId)) {
          seen.add(txnId)
          out.push({ txnId, transactionType: txnType })
        }
      }
      if (row.Rows?.Row) walk(row.Rows.Row)
    }
  }

  walk(report.Rows?.Row)
  return out
}

function normalizeTransactionResource(transactionType: string): string | null {
  const value = transactionType.trim().toLowerCase()
  if (!value) return null
  if (value.includes('journal')) return 'journalentry'
  if (value === 'bill') return 'bill'
  if (value === 'check') return 'check'
  if (value.includes('vendor credit')) return 'vendorcredit'
  if (value === 'purchase' || value === 'expense') return 'purchase'
  if (value === 'transfer') return 'transfer'
  if (value === 'deposit') return 'deposit'
  if (value === 'invoice') return 'invoice'
  if (value === 'payment') return 'payment'
  if (value.includes('bill payment')) return 'billpayment'
  if (value.includes('sales receipt')) return 'salesreceipt'
  if (value.includes('refund receipt')) return 'refundreceipt'
  if (value.includes('credit memo')) return 'creditmemo'
  // QBO REST v3 doesn't expose CreditCardCredit or CreditCardPayment as
  // independent endpoints — they're UI-only aliases over Purchase. Skip the
  // payload fetch; the GL row is already in qb_report_cache so the drill
  // still shows the transaction, just without payload-enriched detail.
  if (value.includes('credit card')) return null
  return null
}

async function backfillTransactionPayloads(
  entity: QboEntity,
  entityId: string,
  report: unknown,
  now: Date,
  label: string,
  force = false,
): Promise<{ fetched: number; skipped: number; failed: number }> {
  const refs = extractTxnRefsFromGl(report as GlReportLike)
  if (refs.length === 0) return { fetched: 0, skipped: 0, failed: 0 }

  // When forced we bypass the cache check — we want fresh payloads even if
  // rows already exist, because a txn's contents may have been edited in QB.
  // Otherwise: a row counts as cached unless it's a stale failure marker
  // (older than FAILURE_MARKER_TTL_MS), in which case we'll re-attempt it.
  const failureMarkerCutoff = new Date(now.getTime() - FAILURE_MARKER_TTL_MS)
  const alreadyCached = force
    ? new Set<string>()
    : new Set(
        (await db.select({ txnId: qbTransactionCache.txnId })
          .from(qbTransactionCache)
          .where(and(
            eq(qbTransactionCache.entityId, entityId),
            inArray(qbTransactionCache.txnId, refs.map((r) => r.txnId)),
            or(
              sql`(${qbTransactionCache.payload}->>'_failed') IS DISTINCT FROM 'true'`,
              gte(qbTransactionCache.fetchedAt, failureMarkerCutoff),
            ),
          )))
          .map((row) => row.txnId),
      )

  const toFetch = refs.filter((r) => !alreadyCached.has(r.txnId))
  if (toFetch.length === 0) {
    console.log(`[qb-reports] ${entityId}: ${label} → ${refs.length} txns, all cached`)
    return { fetched: 0, skipped: refs.length, failed: 0 }
  }

  console.log(`[qb-reports] ${entityId}: ${label} → backfilling ${toFetch.length}/${refs.length} txn payloads…`)
  let fetched = 0
  let failed = 0
  let permanentlyFailed = 0
  let abandoned = 0
  const total = toFetch.length
  const progressEvery = Math.max(25, Math.floor(total / 10))
  let logged = 0
  const startedAt = Date.now()
  let budgetExhausted = false

  const queue = [...toFetch]
  const workers = Array.from({ length: Math.min(TRANSACTION_PAYLOAD_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      if (Date.now() - startedAt >= PAYLOAD_BACKFILL_BUDGET_MS) {
        budgetExhausted = true
        return
      }
      const next = queue.shift()
      if (!next) return
      const resource = normalizeTransactionResource(next.transactionType)
      if (!resource) continue
      const realmId = getQboRealmId(entity)
      const path = `/v3/company/${encodeURIComponent(realmId)}/${resource}/${encodeURIComponent(next.txnId)}?minorversion=65`
      try {
        const payload = await fetchQboJson<unknown>(entity, path)
        await db.insert(qbTransactionCache).values({
          entityId,
          txnId: next.txnId,
          resourceType: resource,
          payload: payload as any,
          fetchedAt: now,
        }).onConflictDoUpdate({
          target: [qbTransactionCache.entityId, qbTransactionCache.txnId],
          set: { resourceType: resource, payload: payload as any, fetchedAt: now },
        })
        fetched++
      } catch (err) {
        failed++
        // Permanent client errors (4xx other than 401/429) almost always mean
        // the txn was deleted in QB. Write a failure marker so subsequent
        // cron runs treat the txnId as cached and don't re-attempt the call;
        // otherwise the same dead IDs bleed time every hour until the 5-min
        // Vercel function timeout fires.
        const isQbHttp = err instanceof QboHttpError
        const isPermanent = isQbHttp && err.status >= 400 && err.status < 500
          && err.status !== 401 && err.status !== 429
        if (isPermanent) {
          permanentlyFailed++
          const marker = {
            _failed: true as const,
            status: (err as QboHttpError).status,
            message: (err as QboHttpError).message.slice(0, 1000),
            intuitTid: (err as QboHttpError).intuitTid,
            firstFailedAt: now.toISOString(),
          }
          try {
            await db.insert(qbTransactionCache).values({
              entityId,
              txnId: next.txnId,
              resourceType: resource,
              payload: marker as any,
              fetchedAt: now,
            }).onConflictDoUpdate({
              target: [qbTransactionCache.entityId, qbTransactionCache.txnId],
              set: { resourceType: resource, payload: marker as any, fetchedAt: now },
            })
          } catch (markerErr) {
            console.warn(`[qb-reports] ${entityId}: failed to persist failure marker for ${next.txnId}: ${(markerErr as Error).message}`)
          }
        }
        console.warn(`[qb-reports] ${entityId}: ${next.transactionType} ${next.txnId} (→ ${resource}) failed${isPermanent ? ' (permanent, marker stored)' : ''}: ${(err as Error).message}`)
      }

      const done = fetched + failed
      if (done - logged >= progressEvery && done < total) {
        console.log(`[qb-reports] ${entityId}: ${label} payloads ${done}/${total} (${fetched} ok, ${failed} failed, ${permanentlyFailed} permanent)`)
        logged = done
      }
    }
  })
  await Promise.all(workers)
  abandoned = queue.length
  if (budgetExhausted) {
    console.warn(`[qb-reports] ${entityId}: ${label} payloads — time budget exhausted, ${abandoned} txns deferred to next run`)
  }
  console.log(`[qb-reports] ${entityId}: ${label} payloads done — ${fetched} fetched, ${failed} failed (${permanentlyFailed} permanent), ${refs.length - toFetch.length} already cached${abandoned ? `, ${abandoned} deferred` : ''}`)

  return { fetched, skipped: refs.length - toFetch.length, failed }
}

// ─────────────────────────────────────────────────────────────────────────
// Force-mode helpers
// ─────────────────────────────────────────────────────────────────────────

/** Canonical string key for a cache row: order-independent filterParams. */
function cacheKey(
  reportType: string,
  periodStart: string,
  periodEnd: string,
  filterParams: unknown,
): string {
  return `${reportType}|${periodStart}|${periodEnd}|${canonicalJson(filterParams)}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return '{' + entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',') + '}'
}

/**
 * After a successful force-refetch for an entity, delete cache rows in the
 * force range that were NOT written this run (i.e., QB no longer returns
 * them: account removed from mapping, moving window changed, etc.). Scoped
 * to a single entity so partial failures in other entities don't corrupt.
 */
async function reconcileReportCache(
  entityId: string,
  forceFromDate: string,
  writtenKeys: Set<string>,
  glAccountScope: Set<string> | null = null,
): Promise<number> {
  const rows = await db
    .select({
      id: qbReportCache.id,
      reportType: qbReportCache.reportType,
      periodStart: qbReportCache.periodStart,
      periodEnd: qbReportCache.periodEnd,
      filterParams: qbReportCache.filterParams,
    })
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityId),
      gte(qbReportCache.periodStart, forceFromDate),
    ))

  const orphanIds = rows
    .filter((r) => {
      // GL rows outside the scope of this run were never refreshed, so
      // missing-from-writtenKeys doesn't mean "QB no longer returns them".
      // Preserve them — they'll be reconciled on a later run whose scope
      // includes them.
      if (glAccountScope !== null && r.reportType === 'general_ledger') {
        const acctNum = (r.filterParams as Record<string, unknown> | null)?.accountNumber
        if (typeof acctNum !== 'string' || !glAccountScope.has(acctNum)) return false
      }
      return !writtenKeys.has(cacheKey(r.reportType, r.periodStart, r.periodEnd, r.filterParams))
    })
    .map((r) => r.id)

  if (orphanIds.length === 0) return 0

  const CHUNK = 500
  let deleted = 0
  for (let i = 0; i < orphanIds.length; i += CHUNK) {
    const chunk = orphanIds.slice(i, i + CHUNK)
    const result = await db
      .delete(qbReportCache)
      .where(inArray(qbReportCache.id, chunk))
      .returning({ id: qbReportCache.id })
    deleted += result.length
  }
  return deleted
}

/**
 * After a successful force-refetch, delete txn_cache rows not referenced by
 * any currently cached GL for this entity. We scope against the full current
 * GL set (not just this run's writes) because a txn might be referenced by a
 * GL outside the force range — deleting it would break unrelated drill-downs.
 */
async function reconcileTxnCache(entityId: string): Promise<number> {
  const glRows = await db
    .select({ data: qbReportCache.data })
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityId),
      eq(qbReportCache.reportType, 'general_ledger'),
    ))

  const referenced = new Set<string>()
  for (const row of glRows) {
    for (const ref of extractTxnRefsFromGl(row.data as GlReportLike)) {
      referenced.add(ref.txnId)
    }
  }

  const cachedTxns = await db
    .select({ txnId: qbTransactionCache.txnId })
    .from(qbTransactionCache)
    .where(eq(qbTransactionCache.entityId, entityId))

  const orphans = cachedTxns.map((r) => r.txnId).filter((id) => !referenced.has(id))
  if (orphans.length === 0) return 0

  const CHUNK = 500
  let deleted = 0
  for (let i = 0; i < orphans.length; i += CHUNK) {
    const chunk = orphans.slice(i, i + CHUNK)
    const result = await db
      .delete(qbTransactionCache)
      .where(and(
        eq(qbTransactionCache.entityId, entityId),
        inArray(qbTransactionCache.txnId, chunk),
      ))
      .returning({ txnId: qbTransactionCache.txnId })
    deleted += result.length
  }
  return deleted
}

// ─────────────────────────────────────────────────────────────────────────
// Main job
// ─────────────────────────────────────────────────────────────────────────

export class ForceRefreshCanceledError extends Error {
  constructor() {
    super('force refresh canceled')
    this.name = 'ForceRefreshCanceledError'
  }
}

export async function fetchQbReportsJob(
  opts?: {
    force?: boolean
    forceFrom?: string
    /**
     * Called at natural break points (start of each entity, between specs).
     * When it resolves true the job aborts with ForceRefreshCanceledError.
     */
    shouldAbort?: () => Promise<boolean>
    /**
     * Called immediately after each entity finishes (including reconcile).
     * Used by the force-refresh route to persist per-entity progress so
     * partial completion is observable even if the function dies before
     * all entities finish.
     */
    onEntityProgress?: (entityId: string, entityResult: unknown) => Promise<void>
    /**
     * Which GL accounts to refresh. 'pnl-typed' (default) is the full set the
     * daily cron uses. 'budget-mapped' narrows GL fetching to budget-mapped
     * accounts only so force-refresh fits under Vercel's 800s budget.
     * Non-GL specs (BS, P&L) always run regardless of scope.
     */
    accountScope?: QbAccountScope
  },
): Promise<{ ok: boolean; [k: string]: unknown }> {
  const now = new Date()
  const shouldAbort = opts?.shouldAbort
  async function abortCheck() {
    if (shouldAbort && (await shouldAbort())) throw new ForceRefreshCanceledError()
  }
  const forceFromDate = opts?.force
    ? `${opts.forceFrom ?? `${HISTORY_START_YEAR}-01`}-01`
    : null
  const accountScope: QbAccountScope = opts?.accountScope ?? 'pnl-typed'

  if (forceFromDate) {
    console.log(`[qb-reports] FORCE: upsert + reconcile for period_start >= ${forceFromDate}`)
  }

  const connections = await db.select().from(qbConnection)
  const results: Record<string, unknown> = {}

  console.log(`[qb-reports] starting: ${connections.length} connected entit${connections.length === 1 ? 'y' : 'ies'}`)

  for (const conn of connections) {
    await abortCheck()
    const qboEntity = entityIdToQboEntity(conn.entityId)
    if (!qboEntity) {
      results[conn.entityId] = { ok: false, error: `Cannot map entity id ${conn.entityId} to a QboEntity` }
      continue
    }
    const entityId = conn.entityId
    const entityStartedAt = Date.now()
    console.log(`[qb-reports] ── ${entityId} ──`)

    let fetched = 0
    let skipped = 0
    let payloadsFetched = 0
    let payloadsSkipped = 0
    let payloadsFailed = 0
    const failures: string[] = []
    const writtenKeys = new Set<string>()

    try {
      await refreshAccountCatalog(qboEntity, entityId, now)
    } catch (err) {
      failures.push(`account_catalog: ${(err as Error).message}`)
      console.warn(`[qb-reports] ${entityId}: account catalog failed: ${(err as Error).message}`)
    }

    // Build specs after the catalog refresh so GL specs can resolve account
    // numbers → QB internal IDs from the freshly-populated qb_account_catalog.
    const specs = await buildSpecsForEntity(entityId, now, accountScope)

    // Track GL account numbers in this run's scope. Used by reconcile so we
    // only delete orphans within scope — non-scope GL cache rows stay intact.
    const glAccountNumbersInScope = new Set<string>()
    for (const spec of specs) {
      if (spec.reportType === 'general_ledger') {
        const acctNum = (spec.filterParams as Record<string, unknown>)?.accountNumber
        if (typeof acctNum === 'string') glAccountNumbersInScope.add(acctNum)
      }
    }

    // Level 1: batch-load every cached row for this entity into an in-memory
    // Map. Replaces the previous per-spec query (one DB roundtrip per spec)
    // with a single bulk query. With ~13K specs per entity, this collapses
    // ~13K queries into 1. Reuses the existing `cacheKey` helper so the
    // ordering of filterParams keys doesn't cause false misses.
    const cachedRows = await db.select().from(qbReportCache).where(
      eq(qbReportCache.entityId, entityId),
    )
    type CachedRow = (typeof cachedRows)[number]
    const cacheMap = new Map<string, CachedRow>(
      cachedRows.map((row) => [
        cacheKey(row.reportType, row.periodStart, row.periodEnd, row.filterParams),
        row,
      ]),
    )

    // Level 2: skip enumeration of closed-month specs that are already cached.
    // Current-month and moving-window specs always pass through (they may be
    // stale). Force-range specs always pass through (force re-fetches them).
    // Missing closed-month specs (e.g., new accounts, post-partial-crash
    // recovery) also pass through and get processed normally.
    const filteredSpecs = specs.filter((spec) => {
      if (!spec.isClosed) return true
      if (forceFromDate !== null && spec.periodStart >= forceFromDate) return true
      return !cacheMap.has(cacheKey(spec.reportType, spec.periodStart, spec.periodEnd, spec.filterParams))
    })

    console.log(
      `[qb-reports] ${entityId}: ${specs.length} specs total, ${filteredSpecs.length} to process`
      + ` (${specs.length - filteredSpecs.length} closed+cached skipped)`,
    )

    for (const spec of filteredSpecs) {
      await abortCheck()
      const inForceRange = forceFromDate !== null && spec.periodStart >= forceFromDate

      // In-memory cache lookup — replaces the per-spec DB query.
      const existingMatch = cacheMap.get(
        cacheKey(spec.reportType, spec.periodStart, spec.periodEnd, spec.filterParams),
      )

      let data: unknown | null = null
      let shouldFetch = false

      if (inForceRange) {
        shouldFetch = true
      } else if (!existingMatch) {
        shouldFetch = true
      } else if (spec.isClosed) {
        data = existingMatch.data
        skipped++
      } else if (now.getTime() - existingMatch.fetchedAt.getTime() < CACHE_STALE_MS) {
        data = existingMatch.data
        skipped++
      } else {
        shouldFetch = true
      }

      if (shouldFetch) {
        try {
          const params: Record<string, string> = {
            start_date: spec.periodStart,
            end_date: spec.periodEnd,
          }
          for (const [k, v] of Object.entries(spec.filterParams)) {
            params[k] = String(v)
          }
          const freshData = await qbFetchReport(qboEntity, spec.reportType, params)

          if (existingMatch) {
            await db.update(qbReportCache)
              .set({ data: freshData as any, fetchedAt: now })
              .where(eq(qbReportCache.id, existingMatch.id))
          } else {
            await db.insert(qbReportCache).values({
              entityId,
              reportType: spec.reportType,
              periodStart: spec.periodStart,
              periodEnd: spec.periodEnd,
              filterParams: spec.filterParams,
              data: freshData as any,
              fetchedAt: now,
            })
          }
          data = freshData
          fetched++
          console.log(`[qb-reports] ${entityId}: ${spec.reportType} ${spec.periodStart}..${spec.periodEnd} fetched`)
        } catch (err) {
          failures.push(`${spec.reportType} ${spec.periodStart}..${spec.periodEnd}: ${(err as Error).message}`)
          console.warn(`[qb-reports] ${entityId}: ${spec.reportType} ${spec.periodStart}..${spec.periodEnd} FAILED: ${(err as Error).message}`)
          continue
        }
      }

      // Record the spec as "authoritative" — anything in the force range that
      // we didn't record here is an orphan the reconciler will remove.
      if (inForceRange) {
        writtenKeys.add(cacheKey(spec.reportType, spec.periodStart, spec.periodEnd, spec.filterParams))
      }

      if (spec.reportType === 'general_ledger' && data) {
        try {
          const label = `GL ${spec.periodStart}..${spec.periodEnd}`
          const batch = await backfillTransactionPayloads(qboEntity, entityId, data, now, label, inForceRange)
          payloadsFetched += batch.fetched
          payloadsSkipped += batch.skipped
          payloadsFailed += batch.failed
        } catch (err) {
          failures.push(`transaction_payloads ${spec.periodStart}..${spec.periodEnd}: ${(err as Error).message}`)
          console.warn(`[qb-reports] ${entityId}: GL payloads ${spec.periodStart}..${spec.periodEnd} FAILED: ${(err as Error).message}`)
        }
      }
    }

    // Reconcile orphans only if (a) we were in force mode, and (b) no failures
    // for this entity. Failed runs leave old cache intact; next clean run
    // finishes the cleanup.
    let reportsPruned = 0
    let txnsPruned = 0
    if (forceFromDate !== null && failures.length === 0) {
      const reconcileScope = accountScope === 'budget-mapped' ? glAccountNumbersInScope : null
      reportsPruned = await reconcileReportCache(entityId, forceFromDate, writtenKeys, reconcileScope)
      txnsPruned = await reconcileTxnCache(entityId)
      if (reportsPruned > 0 || txnsPruned > 0) {
        console.log(`[qb-reports] ${entityId}: reconciled — pruned ${reportsPruned} orphan report rows, ${txnsPruned} orphan txn payloads`)
      }
    }

    const elapsedSec = ((Date.now() - entityStartedAt) / 1000).toFixed(1)
    console.log(
      `[qb-reports] ${entityId}: done — ${fetched} reports fetched, ${skipped} skipped,`
      + ` ${payloadsFetched} payloads fetched (${payloadsSkipped} cached, ${payloadsFailed} failed),`
      + ` ${failures.length} failures · ${elapsedSec}s`,
    )

    results[entityId] = {
      ok: failures.length === 0,
      fetched,
      skipped,
      payloads: { fetched: payloadsFetched, skipped: payloadsSkipped, failed: payloadsFailed },
      pruned: { reports: reportsPruned, txns: txnsPruned },
      failures,
    }

    if (opts?.onEntityProgress) {
      await opts.onEntityProgress(entityId, results[entityId]).catch((err) => {
        console.warn(`[qb-reports] ${entityId}: onEntityProgress callback failed: ${(err as Error).message}`)
      })
    }
  }

  console.log(`[qb-reports] all entities complete`)
  return { ok: true, entities: Object.keys(results).length, results }
}
