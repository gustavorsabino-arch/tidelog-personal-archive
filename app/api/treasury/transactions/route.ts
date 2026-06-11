import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryTransactions, type QbStatusFilter } from '@/lib/treasury-transactions'

const QB_STATUS_VALUES: readonly QbStatusFilter[] = [
  'unposted', 'posted', 'posted_modified', 'posted_manually', 'voided', 'failed',
]

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
  const rawQbStatus = searchParams.get('qbStatus')
  const qbStatus = QB_STATUS_VALUES.includes(rawQbStatus as QbStatusFilter)
    ? (rawQbStatus as QbStatusFilter)
    : null
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
      qbStatus,
      limit,
      offset: off,
    })

    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[treasury/transactions]', e)
    return NextResponse.json(
      { error: 'Failed to load transactions', code: 'internal' },
      { status: 500 },
    )
  }
}
