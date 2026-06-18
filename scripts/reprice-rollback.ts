#!/usr/bin/env bun
import './_prod-env'
/**
 * Phase C1 rollback: restore original price/usd/price_source from
 * app.transaction_price_backup, then the caller re-runs gains recompute.
 * Safe because C1 never touched QuickBooks. Usage:
 *   bun run scripts/reprice-rollback.ts --prod
 *   # then: bun run backfill:orca-gains -- --prod   (recompute back)
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { confirmDestructive, looksLikeProd } from './cron/args'

async function main() {
  const targetUrl = process.env.DATABASE_URL
  if (!targetUrl) { console.error('[reprice-rollback] no DATABASE_URL'); process.exit(1) }
  if (looksLikeProd(targetUrl)) {
    const ok = await confirmDestructive({
      databaseUrl: targetUrl,
      prefix: '[reprice-rollback]',
      describeAction: 'Will RESTORE original price/usd/price_source for all re-priced rows from the backup table.',
      confirmWord: 'rollback-reprice',
    })
    if (!ok) { console.error('[reprice-rollback] aborted'); process.exit(0) }
  }
  // Count what will be restored up-front (== backup rows) for a meaningful summary.
  const cnt = (await db.execute(sql`SELECT count(*)::int AS n FROM app.transaction_price_backup`)) as unknown as { n: number }[]
  const restored = cnt[0]?.n ?? 0
  await db.execute(sql`
    UPDATE app.transaction t
    SET price = b.old_price, usd = b.old_usd, price_source = b.old_price_source
    FROM app.transaction_price_backup b
    WHERE t.id = b.id`)
  const summary = { restored, note: 'now re-run gains recompute to rebuild transaction_gain/fifo_state' }
  await logAudit({ action: 'reprice.rollback', metadata: summary }).catch(() => {})
  console.log('[reprice-rollback] restored originals from backup. Re-run gains recompute next.', summary)
}
await main()
