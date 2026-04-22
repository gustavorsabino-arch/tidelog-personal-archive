import { NextResponse } from 'next/server'
import { desc, eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { price, token as tokenTable } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { getLatestPrice, getPriceAt } from '@/lib/prices'

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
    const tokens = await db.select({ symbol: tokenTable.symbol }).from(tokenTable)
    const prices: Record<string, number | null> = {}
    let lastUpdated: Date | null = null
    for (const t of tokens) {
      const [row] = await db.select({ price: price.price, fetchedAt: price.fetchedAt })
        .from(price)
        .where(and(eq(price.token, t.symbol), eq(price.source, 'latest')))
        .orderBy(desc(price.timestamp))
        .limit(1)
      prices[t.symbol] = row ? Number(row.price) : null
      if (row && (!lastUpdated || row.fetchedAt > lastUpdated)) lastUpdated = row.fetchedAt
    }
    return NextResponse.json({ prices, lastUpdated })
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
