#!/usr/bin/env bun
/**
 * Live smoke test for the Birdeye client.
 *
 * - No BIRDEYE_API_KEY → prints "skipped" and exits 0 (expected pre-provisioning).
 * - With a key → calls all three endpoints for SOL/ORCA, prints prices, and
 *   sanity-compares current price against DeFiLlama.
 *
 * Historical endpoints commonly 401/402 on Birdeye's free tier; that is a plan
 * limitation, reported distinctly, not a code failure.
 *
 * Usage: bun run scripts/birdeye-smoke.ts
 */
import * as birdeye from '@/lib/birdeye'
import * as defillama from '@/lib/defillama'

async function main() {
  if (!birdeye.hasBirdeyeKey) {
    console.log('[smoke] BIRDEYE_API_KEY unset — skipping live smoke (expected pre-provisioning).')
    process.exit(0)
  }

  const tokens = ['SOL', 'ORCA']
  const nowSec = Math.floor(Date.now() / 1000)
  const dayAgo = nowSec - 86400

  console.log('[smoke] current prices (Birdeye multi_price):')
  try {
    const bird = await birdeye.getCurrentPrices(tokens)
    const lama = await defillama.getCurrentPrices(tokens)
    for (const t of tokens) {
      const b = bird[t]
      const l = lama[t]
      const drift = b && l ? `${(((b - l) / l) * 100).toFixed(2)}% vs DeFiLlama` : 'n/a'
      console.log(`  ${t}: birdeye=${b ?? '—'}  defillama=${l ?? '—'}  (${drift})`)
    }
  } catch (e) {
    console.error(`  current FAILED: ${(e as Error).message}`)
  }

  console.log('[smoke] point-in-time (historical_price_unix, 1 day ago):')
  for (const t of tokens) {
    try {
      const p = await birdeye.getHistoricalPrice(t, dayAgo)
      console.log(`  ${t}: ${p ?? 'null (free tier may gate this endpoint — 401/402)'}`)
    } catch (e) {
      console.error(`  ${t} FAILED: ${(e as Error).message}`)
    }
  }

  console.log('[smoke] daily close (history_price type=1D, last 7d):')
  for (const t of tokens) {
    try {
      const pts = await birdeye.getDailyPrices(t, nowSec - 7 * 86400, 7)
      console.log(`  ${t}: ${pts.length} points  last=${pts.at(-1)?.price ?? '—'}`)
      if (pts.length === 0) console.log('    (empty — free tier may gate this endpoint)')
    } catch (e) {
      console.error(`  ${t} FAILED: ${(e as Error).message}`)
    }
  }

  console.log('[smoke] done.')
}

main()
