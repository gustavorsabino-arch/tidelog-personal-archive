import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryOverview } from '@/lib/treasury-overview'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const entityFilter = req.nextUrl.searchParams.get('entity')
  const asOfRaw = req.nextUrl.searchParams.get('as_of')
  if (asOfRaw && !/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw)) {
    return NextResponse.json({ error: 'Invalid historical date' }, { status: 400 })
  }
  try {
    const overview = await getTreasuryOverview(entityFilter, asOfRaw)
    return NextResponse.json(overview)
  } catch (err) {
    const message = (err as Error).message
    return NextResponse.json({ error: message }, {
      status: message.startsWith('Select a completed UTC date') ? 400 : 503,
    })
  }
}

