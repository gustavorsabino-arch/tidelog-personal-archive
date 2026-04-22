import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryOverview } from '@/lib/treasury-overview'

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const entityFilter = req.nextUrl.searchParams.get('entity')
  const overview = await getTreasuryOverview(entityFilter)
  return NextResponse.json(overview)
}
