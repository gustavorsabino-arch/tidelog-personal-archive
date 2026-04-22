import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getLatestPrice, getLatestPrices, getPriceAt } from '@/lib/prices'

// GET /api/prices                            returns latest for all tracked tokens
// GET /api/prices?token=SOL                  returns latest for one token
// GET /api/prices?token=SOL&timestamp=1710000000  returns price at that unix timestamp
export async function GET(req: Request) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const timestamp = url.searchParams.get('timestamp')

  if (!token) {
    // Latest for every tracked token
    const prices = await getLatestPrices()
    return NextResponse.json({ prices, lastUpdated: null })
  }

  if (timestamp) {
    const ts = Number.parseInt(timestamp, 10)
    if (!Number.isFinite(ts)) {
      return NextResponse.json({ error: 'invalid timestamp', code: 'validation.failed' }, { status: 400 })
    }
    const value = await getPriceAt(token, new Date(ts * 1000))
    return NextResponse.json({ token, timestamp: ts, price: value })
  }

  const value = await getLatestPrice(token)
  return NextResponse.json({ token, price: value })
}
