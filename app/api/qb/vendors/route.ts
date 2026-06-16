// GET /api/qb/vendors?entity=Opco — vendor options for the wallet admin dropdown.
// If entity is omitted, returns the union of all QBO entities' vendor catalogs, distinct by name.
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { QBO_ENTITIES, isQboEntity } from '@/lib/qb/config'
import { readCachedVendorCatalog } from '@/lib/qb/cache-reads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny
  const entity = req.nextUrl.searchParams.get('entity')
  if (entity) {
    if (!isQboEntity(entity)) return NextResponse.json({ error: 'valid QB entity required' }, { status: 400 })
    const rows = await readCachedVendorCatalog(entity)
    const vendors = rows.map((r) => ({ qbVendorId: r.qbVendorId, displayName: r.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    return NextResponse.json({ entity, vendors })
  }
  // Union across all QBO entities, distinct by name.
  const names = new Set<string>()
  for (const e of QBO_ENTITIES) {
    const rows = await readCachedVendorCatalog(e)
    for (const r of rows) names.add(r.displayName)
  }
  const vendors = [...names].sort((a, b) => a.localeCompare(b)).map((displayName) => ({ displayName }))
  return NextResponse.json({ entity: null, vendors })
}
