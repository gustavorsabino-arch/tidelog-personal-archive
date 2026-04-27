import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTransactionMonths } from '@/lib/treasury-transactions'

// GET /api/treasury/transactions/months?entity=Opco[&asset=ORCA]
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const { searchParams } = req.nextUrl
  const entity = searchParams.get('entity')
  const asset = searchParams.get('asset')

  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })

  try {
    const months = await getTransactionMonths({ entity, asset })
    return NextResponse.json({ months })
  } catch (e: unknown) {
    console.error('[treasury/transactions/months]', e)
    return NextResponse.json(
      { error: 'Failed to load months', code: 'internal' },
      { status: 500 },
    )
  }
}
