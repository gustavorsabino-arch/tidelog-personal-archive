import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/require-permission'
import { isQboEntity } from '@/lib/qb/config'
import {
  getGlForAccount,
  GlNotCachedError,
  type GlDrillScope,
} from '@/lib/qb/gl-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  entity: z.string().min(1),
  accountNumber: z.string().min(1),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function GET(req: Request) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', code: 'gl.invalid_query', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { entity, accountNumber, periodStart, periodEnd } = parsed.data
  let scope: GlDrillScope
  if (entity === 'All') {
    scope = 'All'
  } else if (isQboEntity(entity)) {
    scope = entity
  } else {
    return NextResponse.json({ error: 'Invalid entity', code: 'gl.invalid_entity' }, { status: 400 })
  }

  try {
    const data = await getGlForAccount(scope, accountNumber, periodStart, periodEnd)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GlNotCachedError) {
      return NextResponse.json(
        { error: err.message, code: err.code, entity: scope, accountNumber, periodStart, periodEnd },
        { status: 404 },
      )
    }
    throw err
  }
}
