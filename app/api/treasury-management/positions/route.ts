import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryManagementData } from '@/lib/treasury-management'

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const entity = req.nextUrl.searchParams.get('entity')
  try {
    const result = await getTreasuryManagementData({ entity })
    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[treasury-management/positions]', e)
    return NextResponse.json(
      { error: 'Failed to load positions', code: 'internal' },
      { status: 500 },
    )
  }
}
