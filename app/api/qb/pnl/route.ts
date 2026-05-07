import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/require-permission'
import { isQboEntity } from '@/lib/qb/config'
import { getPnlData, PnlNotCachedError, type PnlDataScope } from '@/lib/qb/pnl-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  entity: z.string().min(1),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

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
  let scope: PnlDataScope
  if (entity === 'All') {
    scope = 'All'
  } else if (isQboEntity(entity)) {
    scope = entity
  } else {
    return NextResponse.json({ error: 'Invalid entity', code: 'pnl.invalid_entity' }, { status: 400 })
  }

  try {
    const data = await getPnlData(scope, periodStart, periodEnd)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof PnlNotCachedError) {
      return NextResponse.json(
        { error: err.message, code: err.code, entity: scope, periodStart, periodEnd },
        { status: 404 },
      )
    }
    throw err
  }
}
