// POST /api/qb/accounts/refresh?entity=Opco — force an on-demand catalog re-sync.
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { isQboEntity } from '@/lib/qb/config'
import { toDbEntity } from '@/lib/entity'
import { fetchAndStoreAccountCatalog } from '@/lib/cron/fetch-qb-reports'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny
  const entity = req.nextUrl.searchParams.get('entity')
  if (!entity || !isQboEntity(entity)) return NextResponse.json({ error: 'valid QB entity required' }, { status: 400 })
  try {
    const count = await fetchAndStoreAccountCatalog(entity, toDbEntity(entity), new Date())
    return NextResponse.json({ entity, count })
  } catch (err) {
    return NextResponse.json({ error: `QuickBooks refresh failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
  }
}
