import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  qbAccountCatalog,
  qbConnection,
  qbReportCache,
  qbTransactionCache,
  budgetQbMapping,
} from '@/lib/db/schema'
import { fetchQboJson, qbFetchReport, type QbReportType } from '@/lib/qb/client'
import { getQboRealmId, isQboEntity, type QboEntity } from '@/lib/qb/config'

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
 * First year of operation. Closed months before this year are never fetched.
 * Override with QB_HISTORY_START_YEAR if you ever need earlier data.
 */
const HISTORY_START_YEAR = Number(process.env.QB_HISTORY_START_YEAR || '2026')

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

async function buildSpecsForEntity(entityId: string, now: Date = new Date()): Promise<ReportSpec[]> {
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

  // GL: one request per mapped account per month. QB's GeneralLedger report
  // takes a singular `account=<id>` query param — the plural `accounts=`
  // form isn't actually supported, so the only way to get an account-scoped
  // report is to fetch each one individually. Matches v1's behavior.
  const mappings = await db.select({ acct: budgetQbMapping.qbAccountNumber }).from(budgetQbMapping)
  const uniqueAccounts = Array.from(new Set(mappings.map((m) => m.acct))).sort()
  if (uniqueAccounts.length === 0) return specs

  const catalog = await db.select({
    accountNumber: qbAccountCatalog.qbAccountNumber,
    accountId: qbAccountCatalog.qbAccountId,
  }).from(qbAccountCatalog).where(eq(qbAccountCatalog.entityId, entityId))
  const idByNumber = new Map<string, string>()
  for (const row of catalog) {
    if (row.accountNumber) idByNumber.set(row.accountNumber, row.accountId)
  }

  for (const accountNumber of uniqueAccounts) {
    const accountId = idByNumber.get(accountNumber)
    if (!accountId) continue
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
    .from(qbAccountCatalog)
    .where(eq(qbAccountCatalog.entityId, entityId))
    .orderBy(qbAccountCatalog.fetchedAt)
    .limit(1)
  if (fresh && now.getTime() - fresh.fetchedAt.getTime() < ACCOUNT_CATALOG_STALE_MS) {
    console.log(`[qb-reports] ${entityId}: account catalog fresh, skipping`)
    return
  }

  console.log(`[qb-reports] ${entityId}: refreshing account catalog…`)
  const realmId = getQboRealmId(entity)
  const path = `/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent('SELECT * FROM Account MAXRESULTS 1000')}&minorversion=65`
  const response = await fetchQboJson<QboAccountQueryResponse>(entity, path)

  const accounts = response.QueryResponse?.Account ?? []
  if (accounts.length === 0) {
    console.log(`[qb-reports] ${entityId}: account catalog empty`)
    return
  }

  const values = accounts
    .filter((account) => account.Id && account.Name)
    .map((account) => ({
      entityId,
      qbAccountId: String(account.Id),
      qbAccountNumber: account.AcctNum ? String(account.AcctNum) : null,
      qbAccountName: String(account.Name),
      accountType: account.AccountType ? String(account.AccountType) : null,
      fetchedAt: now,
    }))

  if (values.length === 0) return

  await db.transaction(async (tx) => {
    await tx.delete(qbAccountCatalog).where(eq(qbAccountCatalog.entityId, entityId))
    await tx.insert(qbAccountCatalog).values(values)
  })
  console.log(`[qb-reports] ${entityId}: account catalog saved (${values.length} accounts)`)
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
): Promise<{ fetched: number; skipped: number; failed: number }> {
  const refs = extractTxnRefsFromGl(report as GlReportLike)
  if (refs.length === 0) return { fetched: 0, skipped: 0, failed: 0 }

  const alreadyCached = new Set(
    (await db.select({ txnId: qbTransactionCache.txnId })
      .from(qbTransactionCache)
      .where(and(
        eq(qbTransactionCache.entityId, entityId),
        inArray(qbTransactionCache.txnId, refs.map((r) => r.txnId)),
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
  const total = toFetch.length
  const progressEvery = Math.max(25, Math.floor(total / 10))
  let logged = 0

  const queue = [...toFetch]
  const workers = Array.from({ length: Math.min(TRANSACTION_PAYLOAD_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
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
        }).onConflictDoNothing()
        fetched++
      } catch (err) {
        failed++
        console.warn(`[qb-reports] ${entityId}: ${next.transactionType} ${next.txnId} (→ ${resource}) failed: ${(err as Error).message}`)
      }

      const done = fetched + failed
      if (done - logged >= progressEvery && done < total) {
        console.log(`[qb-reports] ${entityId}: ${label} payloads ${done}/${total} (${fetched} ok, ${failed} failed)`)
        logged = done
      }
    }
  })
  await Promise.all(workers)
  console.log(`[qb-reports] ${entityId}: ${label} payloads done — ${fetched} fetched, ${failed} failed, ${refs.length - toFetch.length} already cached`)

  return { fetched, skipped: refs.length - toFetch.length, failed }
}

// ─────────────────────────────────────────────────────────────────────────
// Main job
// ─────────────────────────────────────────────────────────────────────────

export async function fetchQbReportsJob() {
  const now = new Date()
  const connections = await db.select().from(qbConnection)
  const results: Record<string, unknown> = {}

  console.log(`[qb-reports] starting: ${connections.length} connected entit${connections.length === 1 ? 'y' : 'ies'}`)

  for (const conn of connections) {
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

    try {
      await refreshAccountCatalog(qboEntity, entityId, now)
    } catch (err) {
      failures.push(`account_catalog: ${(err as Error).message}`)
      console.warn(`[qb-reports] ${entityId}: account catalog failed: ${(err as Error).message}`)
    }

    // Build specs after the catalog refresh so GL specs can resolve account
    // numbers → QB internal IDs from the freshly-populated qb_account_catalog.
    const specs = await buildSpecsForEntity(entityId, now)
    console.log(`[qb-reports] ${entityId}: ${specs.length} specs to process`)

    for (const spec of specs) {
      // Load every row for this (entity, type, period) — many may exist with
      // different filter_params (one per mapped account for GL). We then
      // pick the match with equal filter_params below.
      const existing = await db.select().from(qbReportCache).where(and(
        eq(qbReportCache.entityId, entityId),
        eq(qbReportCache.reportType, spec.reportType),
        eq(qbReportCache.periodStart, spec.periodStart),
        eq(qbReportCache.periodEnd, spec.periodEnd),
      ))

      const existingMatch = existing.find((row) => JSON.stringify(row.filterParams) === JSON.stringify(spec.filterParams))

      let data: unknown | null = null
      let wroteThisRun = false

      if (existingMatch) {
        if (spec.isClosed) {
          skipped++
          // Still consider backfilling transaction payloads from cached GL
          // rows on the first run where the cache row existed before we
          // shipped qb_transaction_cache.
          data = existingMatch.data
        } else if (now.getTime() - existingMatch.fetchedAt.getTime() < CACHE_STALE_MS) {
          skipped++
          data = existingMatch.data
        } else {
          // Re-fetch.
        }
      }

      if (data === null || (existingMatch && now.getTime() - existingMatch.fetchedAt.getTime() >= CACHE_STALE_MS && !spec.isClosed)) {
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
          wroteThisRun = true
          console.log(`[qb-reports] ${entityId}: ${spec.reportType} ${spec.periodStart}..${spec.periodEnd} fetched`)
        } catch (err) {
          failures.push(`${spec.reportType} ${spec.periodStart}..${spec.periodEnd}: ${(err as Error).message}`)
          console.warn(`[qb-reports] ${entityId}: ${spec.reportType} ${spec.periodStart}..${spec.periodEnd} FAILED: ${(err as Error).message}`)
          continue
        }
      }

      if (spec.reportType === 'general_ledger' && data) {
        try {
          const label = `GL ${spec.periodStart}..${spec.periodEnd}`
          const batch = await backfillTransactionPayloads(qboEntity, entityId, data, now, label)
          payloadsFetched += batch.fetched
          payloadsSkipped += batch.skipped
          payloadsFailed += batch.failed
          void wroteThisRun
        } catch (err) {
          failures.push(`transaction_payloads ${spec.periodStart}..${spec.periodEnd}: ${(err as Error).message}`)
          console.warn(`[qb-reports] ${entityId}: GL payloads ${spec.periodStart}..${spec.periodEnd} FAILED: ${(err as Error).message}`)
        }
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
      failures,
    }
  }

  console.log(`[qb-reports] all entities complete`)
  return { ok: true, entities: Object.keys(results).length, results }
}
