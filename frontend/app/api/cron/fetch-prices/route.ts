import { NextRequest, NextResponse } from 'next/server'
import { readDataFile, writeDataFile } from '@/lib/github'
import { getCurrentPrices, getDailyPrices } from '@/lib/defillama'

const CRON_SECRET = process.env.CRON_SECRET || ''
const PRICE_TOKENS = ['SOL', 'ORCA'] // Non-stable tokens that need price history

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const backfillDays = parseInt(req.nextUrl.searchParams.get('backfill') || '0')
    const cache = await readDataFile<Record<string, unknown>>('prices.json', {}, true)

    // Always fetch current prices
    const prices = await getCurrentPrices(['SOL', 'ORCA', 'USDC', 'USDT'])
    const now = Math.floor(Date.now() / 3600000) * 3600
    for (const [token, price] of Object.entries(prices)) {
      cache[`${token}::${now}`] = price
      cache[`${token}::latest`] = price
    }

    let backfilled = 0

    // Backfill daily historical prices if requested
    if (backfillDays > 0) {
      const startTs = Math.floor(Date.now() / 1000) - backfillDays * 86400
      for (const token of PRICE_TOKENS) {
        const dailyPrices = await getDailyPrices(token, startTs, backfillDays)
        for (const p of dailyPrices) {
          const dayTs = Math.floor(p.timestamp / 86400) * 86400
          // Fill all 24 hourly slots so hourly lookups hit cache
          for (let h = 0; h < 24; h++) {
            const key = `${token}::${dayTs + h * 3600}`
            if (!cache[key]) { cache[key] = p.price; backfilled++ }
          }
        }
        await new Promise(r => setTimeout(r, 500))
      }
    }

    // Prune entries older than 180 days to prevent unbounded growth (I2)
    const cutoff = Math.floor(Date.now() / 1000) - 180 * 86400
    let pruned = 0
    for (const key of Object.keys(cache)) {
      if (key.startsWith('_') || key.endsWith('::latest')) continue
      const parts = key.split('::')
      const ts = parseInt(parts[1])
      if (!isNaN(ts) && ts < cutoff) { delete cache[key]; pruned++ }
    }

    cache._lastUpdated = new Date().toISOString()
    await writeDataFile('prices.json', cache,
      `prices: ${new Date().toISOString().slice(0, 16)}${backfilled ? ` +${backfilled} historical` : ''}${pruned ? ` -${pruned} pruned` : ''}`)

    return NextResponse.json({ ok: true, prices, backfilled, pruned, timestamp: new Date().toISOString() })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[Cron:prices]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
