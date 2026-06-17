/**
 * Price provider wrapper: Birdeye default, DeFiLlama fallback (per-token),
 * with source provenance. NOT yet wired into any consumer — see
 * docs/superpowers/specs/2026-06-11-birdeye-pricing-infrastructure-design.md.
 *
 * Fallback (per token): Birdeye throws/rate-limits, or returns a
 * missing/null/<=0 value → DeFiLlama.
 *
 * Granularity policy (for the later consumer repoint):
 *   - Transaction pricing → getHistoricalPrice (point-in-time).
 *   - EOM / valuation     → getDailyPrices (daily close). Never price a
 *     valuation off an intraday point.
 */
import * as birdeye from '@/lib/birdeye'
import * as defillama from '@/lib/defillama'

export type PriceSource = 'birdeye' | 'defillama'

let warnedNoKey = false
function birdeyeEnabled(): boolean {
  if (!birdeye.hasBirdeyeKey) {
    if (!warnedNoKey) {
      console.warn('[prices] BIRDEYE_API_KEY unset — using DeFiLlama only')
      warnedNoKey = true
    }
    return false
  }
  return true
}

export async function getCurrentPrices(
  tokens = ['SOL', 'ORCA', 'USDC', 'USDT'],
): Promise<{ prices: Record<string, number>; sources: Record<string, PriceSource> }> {
  const prices: Record<string, number> = {}
  const sources: Record<string, PriceSource> = {}

  if (birdeyeEnabled()) {
    try {
      const bird = await birdeye.getCurrentPrices(tokens)
      for (const [sym, p] of Object.entries(bird)) {
        if (typeof p === 'number' && p > 0) {
          prices[sym] = p
          sources[sym] = 'birdeye'
        }
      }
    } catch (e) {
      console.warn(`[prices] Birdeye current failed, falling back: ${(e as Error).message}`)
    }
  }

  const missing = tokens.filter((t) => !(t in prices))
  if (missing.length > 0) {
    const lama = await defillama.getCurrentPrices(missing)
    for (const [sym, p] of Object.entries(lama)) {
      if (typeof p === 'number' && p > 0) {
        prices[sym] = p
        sources[sym] = 'defillama'
      }
    }
  }

  return { prices, sources }
}

export async function getHistoricalPrice(
  token: string,
  timestamp: number,
): Promise<{ price: number; source: PriceSource } | null> {
  if (birdeyeEnabled()) {
    try {
      const p = await birdeye.getHistoricalPrice(token, timestamp)
      if (typeof p === 'number' && p > 0) return { price: p, source: 'birdeye' }
    } catch (e) {
      console.warn(`[prices] Birdeye historical failed, falling back: ${(e as Error).message}`)
    }
  }
  const p = await defillama.getHistoricalPrice(token, timestamp)
  return typeof p === 'number' && p > 0 ? { price: p, source: 'defillama' } : null
}

export async function getDailyPrices(
  token: string,
  startTs: number,
  days = 365,
): Promise<{ points: Array<{ timestamp: number; price: number }>; source: PriceSource }> {
  if (birdeyeEnabled()) {
    try {
      const pts = await birdeye.getDailyPrices(token, startTs, days)
      if (pts.length > 0) return { points: pts, source: 'birdeye' }
    } catch (e) {
      console.warn(`[prices] Birdeye daily failed, falling back: ${(e as Error).message}`)
    }
  }
  const pts = await defillama.getDailyPrices(token, startTs, days)
  return { points: pts, source: 'defillama' }
}

// ⚠️ CLOSING-PRICE INVARIANT — DO NOT REGRESS TO THE MIDNIGHT (00:00) VALUE.
// The finance-confirmed daily close is the price at 23:59:59 UTC
// (CLOSE_SECONDS_INTO_DAY = 86399), the last second of the UTC day — equal to
// the Birdeye type=1D candle close. NEVER price a day's close at 00:00 — via
// historical_price_unix(day 00:00), by flooring a timestamp to day-start (e.g.
// getDayTs), or by reading a daily candle's 00:00 timestamp as the price time.
// Day-start is the OPEN, which misstates end-of-period valuations (open→close
// gaps of 20%+ occur on ORCA/SOL). Verified 2026-06: SOL 06-13 open 66.80 /
// close 68.90. The B1a regression test asserts the returned close != the open.
export const CLOSE_SECONDS_INTO_DAY = 86_399 // 23:59:59 UTC

const SECONDS_PER_DAY = 86_400

export async function getClosingPrice(
  token: string,
  dayTs: number, // any unix-seconds instant within the target UTC day
): Promise<{ price: number; source: PriceSource } | null> {
  const dayStart = Math.floor(dayTs / SECONDS_PER_DAY) * SECONDS_PER_DAY
  const closeTs = dayStart + CLOSE_SECONDS_INTO_DAY
  // Current/future UTC day: 23:59:59 hasn't happened, so there is no final
  // close. Callers fall back to the live price for the in-progress day.
  if (closeTs > Math.floor(Date.now() / 1000)) return null
  return getHistoricalPrice(token, closeTs)
}
