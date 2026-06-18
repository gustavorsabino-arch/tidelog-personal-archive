#!/usr/bin/env bun
import './_prod-env' // MUST be first — remaps DATABASE_URL when --prod, before @/lib/db loads
/**
 * Phase C1: re-price legacy 'cache' (day-level) transactions to exact-second
 * point-in-time Birdeye (DeFiLlama fallback), reversibly and resumably.
 *
 * Resumable: target is `price_source='cache'` (re-priced rows leave the set).
 * Reversible: originals saved to app.transaction_price_backup before overwrite.
 * Unpriceable rows tracked in app.transaction_reprice_failures (attempts>=3 excluded).
 *
 * Usage:
 *   bun run scripts/reprice-cache-transactions.ts --prod                 # all remaining, rate-limited
 *   bun run scripts/reprice-cache-transactions.ts --prod --month 2026-06 # one calendar month
 *   bun run scripts/reprice-cache-transactions.ts --prod --max-rows 5000 # cap this run
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { STABLE_TOKENS } from '@/lib/constants'
import { getHistoricalPrice } from '@/lib/prices'
import { logAudit } from '@/lib/audit'
import { confirmDestructive, looksLikeProd } from './cron/args'
import { planReprice, type RepriceRow } from '@/lib/reprice/plan'

const BATCH = 500

async function ensureTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.transaction_price_backup (
      id uuid PRIMARY KEY,
      old_price numeric(38,18),
      old_usd numeric(20,2),
      old_price_source text,
      backed_up_at timestamptz NOT NULL DEFAULT now()
    )`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.transaction_reprice_failures (
      id uuid PRIMARY KEY,
      attempts int NOT NULL DEFAULT 0,
      last_error text,
      last_attempt_at timestamptz NOT NULL DEFAULT now()
    )`)
}

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (p) return p.split('=')[1]
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const targetUrl = process.env.DATABASE_URL
  if (!targetUrl) { console.error('[reprice] no DATABASE_URL'); process.exit(1) }
  if (looksLikeProd(targetUrl)) {
    const ok = await confirmDestructive({
      databaseUrl: targetUrl,
      prefix: '[reprice]',
      describeAction: "Will UPDATE non-stable 'cache' transactions to point-in-time Birdeye (originals backed up).",
      confirmWord: 'reprice',
    })
    if (!ok) { console.error('[reprice] aborted'); process.exit(0) }
  }

  await ensureTables()

  const stableList = Array.from(STABLE_TOKENS)
  const month = arg('month') // 'YYYY-MM' or undefined
  const maxRows = arg('max-rows') ? Number.parseInt(arg('max-rows')!, 10) : undefined
  const startedAt = Date.now()

  // Target: 'cache' non-stable rows, excluding exhausted failures, newest-first.
  // The data IS the cursor — resume by re-running.
  const rows = (await db.execute(sql`
    SELECT t.id, t.asset, extract(epoch FROM t.block_time)::bigint AS block_time, t.qty, t.price, t.usd, t.price_source
    FROM app.transaction t
    WHERE t.price_source = 'cache'
      AND t.asset NOT IN (${sql.join(stableList.map((s) => sql`${s}`), sql`, `)})
      AND NOT EXISTS (
        SELECT 1 FROM app.transaction_reprice_failures f
        WHERE f.id = t.id AND f.attempts >= 3
      )
      ${month ? sql`AND to_char(t.block_time, 'YYYY-MM') = ${month}` : sql``}
    ORDER BY t.block_time DESC
    ${maxRows ? sql`LIMIT ${maxRows}` : sql``}
  `)) as unknown as RepriceRow[]

  console.log(`[reprice] ${rows.length} rows to process${month ? ` (month ${month})` : ''}${maxRows ? ` (max ${maxRows})` : ''}`)

  // Per-run dedup cache by `${asset}::${blockTime}` (exact second).
  const lookupCache = new Map<string, { price: number; source: string } | null>()
  let repriced = 0
  let failed = 0

  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH)
    for (const row of batch) {
      const key = `${row.asset}::${row.blockTime}`
      if (!lookupCache.has(key)) {
        const r = await getHistoricalPrice(row.asset, Number(row.blockTime)) // rate-limited in lib/birdeye
        lookupCache.set(key, r)
      }
      const action = planReprice({ ...row, qty: Number(row.qty), blockTime: Number(row.blockTime) }, lookupCache.get(key)!)
      if (action.kind === 'fail') {
        await db.execute(sql`
          INSERT INTO app.transaction_reprice_failures (id, attempts, last_error, last_attempt_at)
          VALUES (${row.id}, 1, ${action.error}, now())
          ON CONFLICT (id) DO UPDATE SET attempts = app.transaction_reprice_failures.attempts + 1,
                                         last_error = excluded.last_error, last_attempt_at = now()`)
        failed++
        continue
      }
      // Atomic per-row: backup (never overwrite a true original) then update.
      await db.execute(sql`
        WITH bk AS (
          INSERT INTO app.transaction_price_backup (id, old_price, old_usd, old_price_source)
          VALUES (${row.id}, ${action.backup.oldPrice}, ${action.backup.oldUsd}, ${action.backup.oldPriceSource})
          ON CONFLICT (id) DO NOTHING
        )
        UPDATE app.transaction
        SET price = ${String(action.price)}, usd = ${String(action.usd)}, price_source = ${action.source}
        WHERE id = ${row.id}`)
      repriced++
    }
    console.log(`[reprice]   progress: ${Math.min(start + BATCH, rows.length)}/${rows.length} (repriced=${repriced}, failed=${failed})`)
  }

  const remaining = (await db.execute(sql`
    SELECT count(*)::int AS n FROM app.transaction t
    WHERE t.price_source = 'cache' AND t.asset NOT IN (${sql.join(stableList.map((s) => sql`${s}`), sql`, `)})
  `)) as unknown as { n: number }[]

  const summary = { processed: rows.length, repriced, failed, remainingCache: remaining[0]?.n ?? null, durationMs: Date.now() - startedAt }
  await logAudit({ action: 'reprice.cache-transactions.run', metadata: summary }).catch(() => {})
  console.log(JSON.stringify(summary, null, 2))
}

await main()
