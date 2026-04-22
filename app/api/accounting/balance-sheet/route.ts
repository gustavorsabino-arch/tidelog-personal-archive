import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/require-permission'
import { isQboEntity } from '@/lib/qb/config'
import { getBalanceSheetData } from '@/lib/accounting/balance-sheet-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  entity: z.string().min(1),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// Reads balance-sheet data from qb_report_cache only. The cron stores a row
// for each month-end plus a rolling "today" row; if no exact match exists for
// the requested asOf date, fall back to the most recent cached snapshot on or
// before it.
export async function GET(req: Request) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', code: 'bs.invalid_query', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { entity, asOf } = parsed.data
  if (!isQboEntity(entity)) {
    return NextResponse.json({ error: 'Invalid entity', code: 'bs.invalid_entity' }, { status: 400 })
  }

  const data = await getBalanceSheetData(entity, asOf)
  return NextResponse.json(data)
}
