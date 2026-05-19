#!/usr/bin/env bun
/**
 * One-shot recompute of FIFO gain output (transaction_gain + fifo_state)
 * for every entity. Idempotent — replaces all rows per entity+asset on each
 * run, so it's safe to re-run after a cron failure or backfill of new tx.
 *
 * Calls into the same recompute path the fetch-transactions cron uses
 * (lib/orca-gains-writer.ts), so behavior is guaranteed to match what
 * the cron produces.
 *
 * Usage:
 *   bun run backfill:orca-gains              # all entities
 *   bun run backfill:orca-gains Opco         # one entity
 *
 * Targets DATABASE_URL by default. Set MIGRATE_DATABASE_URL to point at a
 * different DB (typically prod). Prompts for confirmation against any
 * non-localhost host — same guard as backfill-transaction-prices.
 */

import { recomputeEntityGains } from '@/lib/orca-gains-writer'
import { confirmDestructive, looksLikeProd } from './cron/args'

const ENTITIES = ['Opco', 'Foundation', 'Juku', 'Zagreus'] as const

async function main() {
  const targetUrl = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL
  if (!targetUrl) {
    console.error('[backfill-orca-gains] no DATABASE_URL or MIGRATE_DATABASE_URL set')
    process.exit(1)
  }

  // Production safety: prompt before any non-localhost target. Same gate
  // backfill-transaction-prices uses.
  if (looksLikeProd(targetUrl)) {
    const ok = await confirmDestructive({
      databaseUrl: targetUrl,
      prefix: '[backfill-orca-gains]',
      describeAction:
        'Will DELETE+REINSERT transaction_gain rows and rewrite fifo_state for every FIFO-eligible asset per entity.',
      confirmWord: 'backfill-orca-gains',
    })
    if (!ok) {
      console.error('[backfill-orca-gains] aborted')
      process.exit(0)
    }
  }

  const arg = process.argv[2]
  const targets = arg ? [arg] : ENTITIES
  for (const entity of targets) {
    const start = Date.now()
    const { totals } = await recomputeEntityGains(entity)
    const summary = Object.entries(totals).map(([a, n]) => `${a}:${n}`).join(' ')
    console.log(`[backfill-orca-gains] ${entity}: ${summary} in ${Date.now() - start}ms`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
