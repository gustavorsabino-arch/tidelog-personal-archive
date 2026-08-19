import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbAccountCatalog, qbReportCache } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { qbFetchReport } from '@/lib/qb/client'
import { isQboEntity, type QboEntity } from '@/lib/qb/config'

/**
 * GET /api/admin/refresh-gl-account?entity=Opco&accountNumber=71020&year=2026
 *
 * Force-refresh the GL cache for ONE account across every month of `year`
 * up to the current month — the surgical fix for "the P&L drill shows stale
 * months for this account". The hourly cron converges on its own (fairness
 * rotation, commit c24105e) but can take hours to reach a specific starving
 * account; this endpoint does that one account right now.
 *
 * Writes rows in the EXACT shape the cron uses (filterParams
 * { account: <qbAccountId>, accountNumber }) so the read side
 * (readCachedGeneralLedgerForAccount → /api/qb/gl) matches them.
 *
 * Auth: admin:manage_data.
 */
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const url = req.nextUrl
  const entityDisplay = url.searchParams.get('entity') ?? ''
  const accountNumber = url.searchParams.get('accountNumber') ?? ''
  const yearRaw = url.searchParams.get('year')
  const now = new Date()
  const year = yearRaw ? parseInt(yearRaw, 10) : now.getUTCFullYear()

  if (!isQboEntity(entityDisplay)) {
    return NextResponse.json({ error: 'entity must be one of Opco/Foundation/Juku/Zagreus' }, { status: 400 })
  }
  const entity: QboEntity = entityDisplay
  const entityId = entity.toLowerCase()
  if (!/^\d{4,}$/.test(accountNumber)) {
    return NextResponse.json({ error: 'accountNumber must be a numeric GL account number' }, { status: 400 })
  }
  if (!Number.isFinite(year) || year < 2020 || year > now.getUTCFullYear()) {
    return NextResponse.json({ error: 'year out of range' }, { status: 400 })
  }

  // Resolve the QB-internal account id from the catalog (same source the
  // cron uses when building GL specs).
  const [cat] = await db
    .select({ accountId: qbAccountCatalog.qbAccountId })
    .from(qbAccountCatalog)
    .where(and(
      eq(qbAccountCatalog.entityId, entityId),
      eq(qbAccountCatalog.qbAccountNumber, accountNumber),
    ))
    .limit(1)
  if (!cat) {
    return NextResponse.json({
      error: `Account ${accountNumber} not found in ${entity}'s account catalog. Refresh the catalog first (/api/qb/accounts/refresh?entity=${entity}).`,
    }, { status: 404 })
  }

  const lastMonth = year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12
  const startedAt = Date.now()
  const results: { month: string; action: 'inserted' | 'updated'; rows?: number }[] = []
  const failures: { month: string; error: string }[] = []

  for (let m = 1; m <= lastMonth; m++) {
    const mm = String(m).padStart(2, '0')
    const periodStart = `${year}-${mm}-01`
    const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
    const periodEnd = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
    const filterParams = { account: cat.accountId, accountNumber }

    try {
      const data = await qbFetchReport(entity, 'general_ledger', {
        start_date: periodStart,
        end_date: periodEnd,
        account: cat.accountId,
        accountNumber,
      })

      // Find an existing cache row for this (entity, GL, month, account) —
      // filterParams is jsonb so we match accountNumber in JS.
      const candidates = await db
        .select({ id: qbReportCache.id, filterParams: qbReportCache.filterParams })
        .from(qbReportCache)
        .where(and(
          eq(qbReportCache.entityId, entityId),
          eq(qbReportCache.reportType, 'general_ledger'),
          eq(qbReportCache.periodStart, periodStart),
          eq(qbReportCache.periodEnd, periodEnd),
        ))
      const existing = candidates.find((c) => {
        const fp = c.filterParams as Record<string, unknown> | null
        return fp?.accountNumber === accountNumber
      })

      if (existing) {
        await db.update(qbReportCache)
          .set({ data: data as never, fetchedAt: now })
          .where(eq(qbReportCache.id, existing.id))
        results.push({ month: mm, action: 'updated' })
      } else {
        await db.insert(qbReportCache).values({
          entityId,
          reportType: 'general_ledger',
          periodStart,
          periodEnd,
          filterParams,
          data: data as never,
          fetchedAt: now,
        })
        results.push({ month: mm, action: 'inserted' })
      }
    } catch (err) {
      failures.push({ month: mm, error: (err as Error).message })
    }
  }

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: failures.length === 0
      ? 'admin.refresh_gl_account.succeeded'
      : 'admin.refresh_gl_account.partial',
    resourceType: 'qb_report_cache',
    resourceId: `${entityId}:${accountNumber}:${year}`,
    metadata: {
      byEmail: user.email,
      entity,
      accountNumber,
      year,
      durationMs: Date.now() - startedAt,
      months: results,
      failures,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: failures.length === 0,
    entity,
    accountNumber,
    year,
    monthsRefreshed: results,
    failures,
    elapsedMs: Date.now() - startedAt,
    note: 'Reopen the P&L/BS drill for this account — it now reads fresh cache.',
  })
}
