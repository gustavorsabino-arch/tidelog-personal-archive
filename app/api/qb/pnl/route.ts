import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/require-permission'
import { isQboEntity } from '@/lib/qb/config'
import { getPnlData, PnlNotCachedError } from '@/lib/qb/pnl-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  entity: z.string().min(1),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// Reads P&L data from qb_report_cache only. The cron caches one row per
// calendar month; single-month queries match that row directly, and multi-
// month (e.g. YTD) queries aggregate the months that fall inside the range.
export async function GET(req: Request) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', code: 'pnl.invalid_query', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { entity, periodStart, periodEnd } = parsed.data
  if (!isQboEntity(entity)) {
    return NextResponse.json({ error: 'Invalid entity', code: 'pnl.invalid_entity' }, { status: 400 })
  }

  try {
    const data = await getPnlData(entity, periodStart, periodEnd)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof PnlNotCachedError) {
      return NextResponse.json(
        { error: err.message, code: err.code, entity, periodStart, periodEnd },
        { status: 404 },
      )
    }
    throw err
  }
}
