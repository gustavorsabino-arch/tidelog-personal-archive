import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getTreasuryOverview } from '@/lib/treasury-overview'

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const entityFilter = req.nextUrl.searchParams.get('entity')
  const asOfRaw = req.nextUrl.searchParams.get('as_of')
  // Strict ISO date — anything else is silently ignored so the view falls back
  // to "latest" rather than 500ing on a typo'd query string.
  const asOf = asOfRaw && /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : null
  const overview = await getTreasuryOverview(entityFilter, asOf)
  return NextResponse.json(overview)
}
