import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbAccountCatalog, qbReportCache } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { qbFetchReport } from '@/lib/qb/client'
import { isQboEntity, type QboEntity } from '@/lib/qb/config'
import { parseQboGeneralLedgerRows } from '@/lib/budget/qb-general-ledger'

/**
 * GET /api/admin/refresh-gl-account?entity=Opco&accountNumber=71020&year=2026
 * GET /api/admin/refresh-gl-account?entity=Opco&all=true&year=2026
 *
 * Force-refresh the per-account GL cache. Two modes:
 *
 * SINGLE (accountNumber=…): re-fetch every month of `year` for one account,
 * unconditionally. The surgical fix for one known-stale account.
 *
 * ALL (all=true): sweep every GL-relevant account in the entity's catalog
 * and re-fetch ONLY months whose cache row is missing OR parses to zero
 * transactions. Repairs the damage from retroactive bookings (closed months
 * cached empty before the JEs were posted — the cron never re-visits closed
 * months) without wasting QB calls on healthy rows. Months that are
 * legitimately empty get re-fetched once per sweep — harmless.
 *
 * Time-budgeted: stops cleanly ~40s before Vercel's wall and reports
 * progress; hit the URL again to continue (already-repaired rows are
 * skipped on re-runs, so successive sweeps converge).
 *
 * Auth: admin:manage_data.
 */
export const maxDuration = 300
const TIME_BUDGET_MS = 260_000

// Same account types the cron caches GL for (lib/cron/gl-account-list.ts).
const GL_ACCOUNT_TYPES = new Set([
  'Income', 'Expense', 'Other Income', 'Other Expense', 'Cost of Goods Sold',
  'Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset',
  'Other Asset', 'Accounts Payable', 'Credit Card', 'Other Current Liability',
  'Long Term Liability', 'Equity',
])

type MonthRange = { mm: string; periodStart: string; periodEnd: string }

function monthsOfYear(year: number, now: Date): MonthRange[] {
  const lastMonth = year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12
  const out: MonthRange[] = []
  for (let m = 1; m <= lastMonth; m++) {
    const mm = String(m).padStart(2, '0')
    const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
    out.push({ mm, periodStart: `${year}-${mm}-01`, periodEnd: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` })
  }
  return out
}

export async function GET(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const url = req.nextUrl
  const entityDisplay = url.searchParams.get('entity') ?? ''
  const accountNumberParam = url.searchParams.get('accountNumber')
  const allMode = url.searchParams.get('all') === 'true'
  const yearRaw = url.searchParams.get('year')
  const now = new Date()
  const year = yearRaw ? parseInt(yearRaw, 10) : now.getUTCFullYear()

  if (!isQboEntity(entityDisplay)) {
    return NextResponse.json({ error: 'entity must be one of Opco/Foundation/Juku/Zagreus' }, { status: 400 })
  }
  const entity: QboEntity = entityDisplay
  const entityId = entity.toLowerCase()
  if (!allMode && !/^\d{4,}$/.test(accountNumberParam ?? '')) {
    return NextResponse.json({ error: 'Pass accountNumber=<GL number> or all=true' }, { status: 400 })
  }
  if (!Number.isFinite(year) || year < 2020 || year > now.getUTCFullYear()) {
    return NextResponse.json({ error: 'year out of range' }, { status: 400 })
  }

  // Account set: one account, or every GL-relevant account in the catalog.
  const catalogRows = await db
    .select({
      accountNumber: qbAccountCatalog.qbAccountNumber,
      accountId: qbAccountCatalog.qbAccountId,
      accountType: qbAccountCatalog.accountType,
    })
    .from(qbAccountCatalog)
    .where(eq(qbAccountCatalog.entityId, entityId))

  const accounts = (allMode
    ? catalogRows.filter((r) => r.accountNumber && r.accountType && GL_ACCOUNT_TYPES.has(r.accountType))
    : catalogRows.filter((r) => r.accountNumber === accountNumberParam)
  ).map((r) => ({ accountNumber: r.accountNumber as string, accountId: r.accountId }))
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))

  if (accounts.length === 0) {
    return NextResponse.json({
      error: allMode
        ? `No GL-typed accounts in ${entity}'s catalog. Refresh the catalog first.`
        : `Account ${accountNumberParam} not found in ${entity}'s account catalog. Refresh the catalog first (/api/qb/accounts/refresh?entity=${entity}).`,
    }, { status: 404 })
  }

  const months = monthsOfYear(year, now)

  // Bulk-load this entity's GL cache rows for the year so per-(account,month)
  // checks are in-memory instead of one query each.
  const cachedRows = await db
    .select({
      id: qbReportCache.id,
      periodStart: qbReportCache.periodStart,
      periodEnd: qbReportCache.periodEnd,
      filterParams: qbReportCache.filterParams,
      data: qbReportCache.data,
    })
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entityId),
      eq(qbReportCache.reportType, 'general_ledger'),
      inArray(qbReportCache.periodStart, months.map((m) => m.periodStart)),
    ))
  const cacheByKey = new Map<string, (typeof cachedRows)[number]>()
  for (const row of cachedRows) {
    const fp = row.filterParams as Record<string, unknown> | null
    const acct = typeof fp?.accountNumber === 'string' ? fp.accountNumber : null
    if (acct) cacheByKey.set(`${acct}:${row.periodStart}`, row)
  }

  const startedAt = Date.now()
  let fetched = 0
  let skippedHealthy = 0
  const repaired: { account: string; month: string; action: 'inserted' | 'updated'; rows: number }[] = []
  const failures: { account: string; month: string; error: string }[] = []
  let budgetExhausted = false

  outer:
  for (const acct of accounts) {
    for (const m of months) {
      if (Date.now() - startedAt >= TIME_BUDGET_MS) {
        budgetExhausted = true
        break outer
      }

      const existing = cacheByKey.get(`${acct.accountNumber}:${m.periodStart}`)
      if (existing && !allMode) {
        // Single-account mode refreshes unconditionally.
      } else if (existing) {
        // ALL mode: skip rows that already parse to transactions.
        const parsedCount = (() => {
          try { return parseQboGeneralLedgerRows(existing.data as never).length } catch { return 0 }
        })()
        if (parsedCount > 0) {
          skippedHealthy++
          continue
        }
      }

      try {
        const data = await qbFetchReport(entity, 'general_ledger', {
          start_date: m.periodStart,
          end_date: m.periodEnd,
          account: acct.accountId,
          accountNumber: acct.accountNumber,
        })
        fetched++
        const newRowCount = (() => {
          try { return parseQboGeneralLedgerRows(data as never).length } catch { return 0 }
        })()

        if (existing) {
          await db.update(qbReportCache)
            .set({ data: data as never, fetchedAt: now })
            .where(eq(qbReportCache.id, existing.id))
          if (newRowCount > 0 || !allMode) {
            repaired.push({ account: acct.accountNumber, month: m.mm, action: 'updated', rows: newRowCount })
          }
        } else {
          await db.insert(qbReportCache).values({
            entityId,
            reportType: 'general_ledger',
            periodStart: m.periodStart,
            periodEnd: m.periodEnd,
            filterParams: { account: acct.accountId, accountNumber: acct.accountNumber },
            data: data as never,
            fetchedAt: now,
          })
          repaired.push({ account: acct.accountNumber, month: m.mm, action: 'inserted', rows: newRowCount })
        }
      } catch (err) {
        failures.push({ account: acct.accountNumber, month: m.mm, error: (err as Error).message })
        // A realm/token failure will fail every call — bail instead of
        // burning the budget on guaranteed failures.
        if ((err as Error).message.includes('token exchange failed')) {
          budgetExhausted = false
          break outer
        }
      }
    }
  }

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: failures.length === 0
      ? 'admin.refresh_gl_account.succeeded'
      : 'admin.refresh_gl_account.partial',
    resourceType: 'qb_report_cache',
    resourceId: `${entityId}:${allMode ? 'ALL' : accountNumberParam}:${year}`,
    metadata: {
      byEmail: user.email,
      entity,
      mode: allMode ? 'all' : 'single',
      year,
      durationMs: Date.now() - startedAt,
      accountsInScope: accounts.length,
      qbCallsMade: fetched,
      skippedHealthy,
      repairedCount: repaired.length,
      failures: failures.slice(0, 20),
      budgetExhausted,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: failures.length === 0,
    entity,
    mode: allMode ? 'all' : 'single',
    year,
    accountsInScope: accounts.length,
    qbCallsMade: fetched,
    skippedHealthy,
    repaired,
    failures,
    budgetExhausted,
    elapsedMs: Date.now() - startedAt,
    note: budgetExhausted
      ? 'Time budget hit — hit this URL again to continue the sweep (already-repaired rows are skipped).'
      : 'Sweep complete. Reopen the P&L/BS drills — they now read fresh cache.',
  })
}
