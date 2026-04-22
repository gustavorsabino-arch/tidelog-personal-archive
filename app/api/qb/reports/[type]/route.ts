import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbReportCache } from '@/lib/db/schema/quickbooks'
import { requirePermission } from '@/lib/auth/require-permission'

const REPORT_TYPES = ['balance_sheet', 'profit_and_loss', 'general_ledger'] as const
type QbReportType = typeof REPORT_TYPES[number]

const QuerySchema = z.object({
  entity: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  account: z.string().optional(),
})

export async function GET(
  req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny

  const { type } = await params
  if (!REPORT_TYPES.includes(type as QbReportType)) {
    return NextResponse.json(
      { error: 'Invalid report type', code: 'qb.invalid_type' },
      { status: 400 },
    )
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', code: 'qb.invalid_query', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const q = parsed.data
  const filterParams = q.account ? { account: q.account } : {}
  const conditions: SQL[] = [
    eq(qbReportCache.entityId, q.entity),
    eq(qbReportCache.reportType, type as QbReportType),
    eq(qbReportCache.periodStart, q.periodStart),
    eq(qbReportCache.periodEnd, q.periodEnd),
    eq(qbReportCache.filterParams, filterParams),
  ]

  const [row] = await db
    .select()
    .from(qbReportCache)
    .where(and(...conditions))
    .limit(1)

  if (!row) {
    return NextResponse.json(
      { error: 'Report not cached yet. Cron runs hourly.', code: 'qb.not_cached' },
      { status: 404 },
    )
  }

  return NextResponse.json({ data: row.data, fetchedAt: row.fetchedAt, stale: false })
}
