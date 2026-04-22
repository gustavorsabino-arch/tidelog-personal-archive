import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryGainLoss } from '@/lib/treasury-gain-loss'

// GET /api/treasury/gain-loss?entity=Opco
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const entity = req.nextUrl.searchParams.get('entity')
  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })

  try {
    const result = await getTreasuryGainLoss(entity)
    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[treasury/gain-loss]', e)
    return NextResponse.json(
      { error: 'Failed to load gain/loss', code: 'internal' },
      { status: 500 },
    )
  }
}
