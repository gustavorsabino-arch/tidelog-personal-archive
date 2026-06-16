// GET /api/qb/classes?entity=Opco — class options for the wallet admin dropdown.
// If entity is omitted, returns the union of all QBO entities' class catalogs, distinct by name.
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { QBO_ENTITIES, isQboEntity } from '@/lib/qb/config'
import { readCachedClassCatalog } from '@/lib/qb/cache-reads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny
  const entity = req.nextUrl.searchParams.get('entity')
  if (entity) {
    if (!isQboEntity(entity)) return NextResponse.json({ error: 'valid QB entity required' }, { status: 400 })
    const rows = await readCachedClassCatalog(entity)
    const classes = rows.map((r) => ({ qbClassId: r.qbClassId, qbClassName: r.qbClassName }))
      .sort((a, b) => a.qbClassName.localeCompare(b.qbClassName))
    return NextResponse.json({ entity, classes })
  }
  // Union across all QBO entities, distinct by name.
  const names = new Set<string>()
  for (const e of QBO_ENTITIES) {
    const rows = await readCachedClassCatalog(e)
    for (const r of rows) names.add(r.qbClassName)
  }
  const classes = [...names].sort((a, b) => a.localeCompare(b)).map((qbClassName) => ({ qbClassName }))
  return NextResponse.json({ entity: null, classes })
}
