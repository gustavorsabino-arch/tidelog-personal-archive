import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getOrcaLedger } from '@/lib/orca-ledger'

// GET /api/treasury/orca-ledger?entity=Opco
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const entity = req.nextUrl.searchParams.get('entity')
  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })

  try {
    const result = await getOrcaLedger(entity)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[treasury/orca-ledger]', e)
    return NextResponse.json(
      { error: 'Failed to load ORCA ledger', code: 'internal' },
      { status: 500 },
    )
  }
}
