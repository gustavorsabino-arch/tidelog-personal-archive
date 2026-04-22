import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryTransactions } from '@/lib/treasury-transactions'

// GET /api/treasury/transactions?entity=Opco&from=1710000000&to=1711000000&asset=SOL&limit=500&offset=0
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const { searchParams } = req.nextUrl
  const entity = searchParams.get('entity')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const asset = searchParams.get('asset')
  const direction = searchParams.get('direction')
  const wallet = searchParams.get('wallet')
  const rawLimit = searchParams.get('limit')
  // `limit=all` or `limit=0` → unbounded (internal callers with FIFO-style
  // computations need the full history). Any positive int is honored. Missing
  // → default 500.
  const limit: number | null = rawLimit === 'all' || rawLimit === '0'
    ? null
    : parseInt(rawLimit ?? '500', 10) || 500
  const off = parseInt(searchParams.get('offset') || '0')

  if (!entity) return NextResponse.json({ error: 'entity required' }, { status: 400 })

  try {
    const result = await getTreasuryTransactions({
      entity,
      from,
      to,
      asset,
      direction,
      wallet,
      limit,
      offset: off,
    })

    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
