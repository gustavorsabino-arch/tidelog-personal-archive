#!/usr/bin/env bun
/**
 * One-shot enrichment for existing transaction rows that have null
 * price/usd/priceSource for non-stable tokens. Calls hydrateTransactionPrices
 * (same code path as the fetch-transactions cron) and UPDATEs each row.
 *
 * Idempotent: rows already priced are skipped by the WHERE clause.
 *
 * Usage:
 *   bun run scripts/backfill-transaction-prices.ts
 *
 * Targets DATABASE_URL by default. Set MIGRATE_DATABASE_URL to point at a
 * different DB (typically prod). Prompts for confirmation against any non-
 * localhost host.
 */

import { and, eq, isNull, asc, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transaction } from '@/lib/db/schema'
import { STABLE_TOKENS } from '@/lib/constants'
import { hydrateTransactionPrices } from '@/lib/transaction-pricing'
import { rowToTransaction } from '@/lib/treasury-transactions'
import { logAudit } from '@/lib/audit'
import { confirmDestructive, looksLikeProd } from './cron/args'

async function main() {
  const targetUrl = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL
  if (!targetUrl) {
    console.error('[backfill] no DATABASE_URL or MIGRATE_DATABASE_URL set')
    process.exit(1)
  }

  if (looksLikeProd(targetUrl)) {
    const ok = await confirmDestructive({
      databaseUrl: targetUrl,
      prefix: '[backfill]',
      describeAction: 'Will UPDATE transaction rows with null price/usd for non-stable tokens.',
      confirmWord: 'backfill',
    })
    if (!ok) {
      console.error('[backfill] aborted')
      process.exit(0)
    }
  }

  const startedAt = Date.now()
  const stableList = Array.from(STABLE_TOKENS)

  // Pull every unpriced non-stable row.
  const rows = await db
    .select()
    .from(transaction)
    .where(and(
      isNull(transaction.priceSource),
      sql`${transaction.asset} NOT IN ${stableList}`,
    ))
    .orderBy(asc(transaction.blockTime))

  console.log(`[backfill] found ${rows.length} rows to enrich`)
  if (rows.length === 0) {
    console.log(JSON.stringify({ scanned: 0, updated: 0, stillNull: 0, durationMs: Date.now() - startedAt }, null, 2))
    return
  }

  const txs = rows.map((row) => rowToTransaction(row, ''))

  const priceCache: Record<string, unknown> = {}

  const { transactions: hydrated } = await hydrateTransactionPrices(txs, {
    priceCache,
    fetchMissingHistory: true,
  })

  let updated = 0
  let stillNull = 0
  for (let i = 0; i < rows.length; i++) {
    const original = rows[i]
    const h = hydrated[i]
    if (h.price == null || h.usd == null) {
      stillNull++
      continue
    }
    await db.update(transaction).set({
      price: String(h.price),
      usd: String(h.usd),
      priceSource: h.priceSource,
    }).where(eq(transaction.id, original.id))
    updated++
  }

  const durationMs = Date.now() - startedAt
  await logAudit({
    action: 'backfill.transaction-prices.completed',
    metadata: { scanned: rows.length, updated, stillNull, durationMs },
  }).catch(() => {})

  console.log(JSON.stringify({ scanned: rows.length, updated, stillNull, durationMs }, null, 2))
}

await main()
