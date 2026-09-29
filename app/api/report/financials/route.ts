import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { readCachedReportsInRangeWithPeriod } from '@/lib/qb/cache-reads'
import { QBO_ENTITIES } from '@/lib/qb/config'
import type { QboProfitAndLossReport } from '@/lib/qb/pnl'
import { buildPresentationFinancials } from '@/lib/presentation/financials'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny

  const year = Number(new URL(req.url).searchParams.get('year'))
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }

  const reports = await Promise.all(QBO_ENTITIES.map(async (entity) => {
    const rows = await readCachedReportsInRangeWithPeriod<QboProfitAndLossReport>(
      entity, 'profit_and_loss', `${year}-01-01`, `${year}-12-31`,
    )
    return rows.map((row) => ({ entity, periodStart: row.periodStart, data: row.data }))
  }))
  return NextResponse.json(buildPresentationFinancials(year, reports.flat()))
}
