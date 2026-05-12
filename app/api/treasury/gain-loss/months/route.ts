import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getGainLossMonths } from '@/lib/treasury-gain-loss'

// GET /api/treasury/gain-loss/months?entity=Opco
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const entity = req.nextUrl.searchParams.get('entity')
  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })

  try {
    const months = await getGainLossMonths(entity)
    return NextResponse.json({ months })
  } catch (e: unknown) {
    console.error('[treasury/gain-loss/months]', e)
    return NextResponse.json(
      { error: 'Failed to load months', code: 'internal' },
      { status: 500 },
    )
  }
}
