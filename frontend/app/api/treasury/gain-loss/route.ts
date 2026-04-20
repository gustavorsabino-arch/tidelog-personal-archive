import { NextRequest, NextResponse } from 'next/server'
import { getTreasuryGainLoss } from '@/lib/treasury-gain-loss'

// GET /api/treasury/gain-loss?entity=Opco
export async function GET(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get('entity')

  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })

  try {
    const result = await getTreasuryGainLoss(entity)
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
