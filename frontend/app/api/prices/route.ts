import { NextRequest, NextResponse } from 'next/server'
import { readDataFile } from '@/lib/github'
import { extractLatestPrices } from '@/lib/overview'

// GET /api/prices?token=SOL&timestamp=1710000000
// GET /api/prices (returns latest)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const token = searchParams.get('token')
  const timestamp = searchParams.get('timestamp')

  const cache = await readDataFile<Record<string, unknown>>('prices.json', {})

  if (!token) {
    const prices = extractLatestPrices(cache)
    return NextResponse.json({
      prices,
      lastUpdated: cache._lastUpdated || null,
    })
  }

  if (timestamp) {
    // Try exact hour, then day, then nearest
    const ts = parseInt(timestamp)
    const hourTs = Math.floor(ts / 3600) * 3600
    const dayTs = Math.floor(ts / 86400) * 86400

    let price = cache[`${token}::${hourTs}`] as number | undefined
    if (!price) price = cache[`${token}::${dayTs}`] as number | undefined
    if (!price) {
      // Nearest within 2 days
      for (let offset = -2; offset <= 2; offset++) {
        price = cache[`${token}::${dayTs + offset * 86400}`] as number | undefined
        if (price) break
      }
    }

    return NextResponse.json({ token, timestamp: ts, price: price || null })
  }

  // Latest for specific token
  const price = cache[`${token}::latest`]
  return NextResponse.json({ token, price: typeof price === 'number' ? price : null })
}
