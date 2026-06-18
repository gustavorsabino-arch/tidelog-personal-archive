#!/usr/bin/env bun
import './_prod-env'
/**
 * Phase C1 delta report. Run order:
 *   1. bun run scripts/reprice-cache-transactions.ts --prod   (re-price, possibly over several runs)
 *   2. bun run scripts/reprice-delta-report.ts --prod --snapshot   (capture pre-recompute gains)
 *   3. bun run backfill:orca-gains -- --prod                       (recompute gains)  [see Task 5 note]
 *   4. bun run scripts/reprice-delta-report.ts --prod --report     (emit the finance report)
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

async function snapshot() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.transaction_gain_snapshot (
      entity_id text NOT NULL, asset text NOT NULL,
      st_gain numeric, lt_gain numeric, captured_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (entity_id, asset)
    )`)
  await db.execute(sql`DELETE FROM app.transaction_gain_snapshot`)
  await db.execute(sql`
    INSERT INTO app.transaction_gain_snapshot (entity_id, asset, st_gain, lt_gain)
    SELECT entity_id, asset, sum(st_gain), sum(lt_gain)
    FROM app.transaction_gain GROUP BY entity_id, asset`)
  console.log('[reprice-report] pre-recompute gains snapshot captured')
}

async function report() {
  // Cost-basis shift: re-priced rows (in backup) — new usd vs old usd, by asset.
  const basis = await db.execute(sql`
    SELECT t.asset,
           count(*)::int AS rows,
           round(sum(abs(t.usd))::numeric, 2) AS new_usd,
           round(sum(abs(b.old_usd))::numeric, 2) AS old_usd
    FROM app.transaction_price_backup b
    JOIN app.transaction t ON t.id = b.id
    GROUP BY t.asset ORDER BY t.asset`)

  // Realized-gains delta: current (post-recompute) vs snapshot (pre).
  const gains = await db.execute(sql`
    SELECT g.entity_id, g.asset,
           round(sum(g.st_gain + g.lt_gain)::numeric, 2) AS new_realized,
           round(coalesce(s.st_gain + s.lt_gain, 0)::numeric, 2) AS old_realized
    FROM app.transaction_gain g
    LEFT JOIN app.transaction_gain_snapshot s ON s.entity_id = g.entity_id AND s.asset = g.asset
    GROUP BY g.entity_id, g.asset, s.st_gain, s.lt_gain
    ORDER BY g.entity_id, g.asset`)

  // QB impact: re-priced txs that are currently POSTED (postId not null) → C2 re-post workload.
  const qb = await db.execute(sql`
    SELECT q.entity_id, count(*)::int AS posted_jes_affected
    FROM app.transaction_price_backup b
    JOIN app.transaction t ON t.id = b.id
    JOIN app.tx_qb_state q ON q.tx_hash = t.tx_hash AND q.wallet_address = t.wallet_address
                          AND q.direction = t.direction AND q.asset = t.asset
    WHERE q.post_id IS NOT NULL
    GROUP BY q.entity_id ORDER BY q.entity_id`)

  // Unpriceable rows.
  const unpriceable = await db.execute(sql`
    SELECT count(*)::int AS n FROM app.transaction_reprice_failures WHERE attempts >= 3`)

  console.log(JSON.stringify({ costBasisByAsset: basis, realizedGainsDelta: gains, qbPostedAffectedByEntity: qb, unpriceable }, null, 2))
}

async function main() {
  if (process.argv.includes('--snapshot')) return snapshot()
  if (process.argv.includes('--report')) return report()
  console.error('[reprice-report] pass --snapshot (before recompute) or --report (after)')
  process.exit(1)
}
await main()
