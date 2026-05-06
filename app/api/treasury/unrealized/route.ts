import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryUnrealized } from '@/lib/treasury-unrealized'

// GET /api/treasury/unrealized?entity=Opco&asOf=YYYY-MM
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const entity = req.nextUrl.searchParams.get('entity')
  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })

  const asOf = req.nextUrl.searchParams.get('asOf')

  try {
    const result = await getTreasuryUnrealized({ entity, asOf })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[treasury/unrealized]', e)
    return NextResponse.json(
      { error: 'Failed to load unrealized positions', code: 'internal' },
      { status: 500 },
    )
  }
}
