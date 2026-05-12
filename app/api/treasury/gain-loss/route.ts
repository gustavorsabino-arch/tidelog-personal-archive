import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryGainLoss } from '@/lib/treasury-gain-loss'

// GET /api/treasury/gain-loss?entity=Opco[&from=<unix-sec>&to=<unix-sec>]
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const { searchParams } = req.nextUrl
  const entity = searchParams.get('entity')
  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })

  const fromStr = searchParams.get('from')
  const toStr = searchParams.get('to')
  const from = fromStr ? Number(fromStr) : null
  const to = toStr ? Number(toStr) : null
  if ((fromStr && !Number.isFinite(from)) || (toStr && !Number.isFinite(to))) {
    return NextResponse.json({ error: 'invalid from/to' }, { status: 400 })
  }

  try {
    const result = await getTreasuryGainLoss(entity, { from, to })
    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[treasury/gain-loss]', e)
    return NextResponse.json(
      { error: 'Failed to load gain/loss', code: 'internal' },
      { status: 500 },
    )
  }
}
