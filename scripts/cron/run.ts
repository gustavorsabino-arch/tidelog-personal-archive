#!/usr/bin/env bun
/**
 * CLI runner for cron jobs.
 *
 * Usage:
 *   bun run cron <job-name> [flags]
 *
 * Jobs:
 *   fetch-prices, fetch-balances, fetch-transactions, fetch-qb-reports,
 *   refresh-qb-tokens, prune-cache
 *
 * Flags:
 *   --full                     (fetch-transactions only) drain full wallet history
 *   --force [--from=YYYY-MM]   (fetch-qb-reports only) delete cached rows in
 *                              range and re-fetch from QuickBooks. --from
 *                              defaults to 2026-01. Prompts before running
 *                              against a non-localhost database.
 */

import { createInterface } from 'node:readline/promises'
import { logAudit } from '@/lib/audit'
import { fetchBalancesJob } from '@/lib/cron/fetch-balances'
import { fetchPricesJob } from '@/lib/cron/fetch-prices'
import { fetchQbReportsJob } from '@/lib/cron/fetch-qb-reports'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'
import { pruneCacheJob } from '@/lib/cron/prune-cache'
import { refreshQbTokensJob } from '@/lib/cron/refresh-qb-tokens'
import { CRON_HISTORY_START, looksLikeProd, parseCronArgs } from './args'

type JobResult = { ok: boolean; [k: string]: unknown }
type JobOptions = { full?: boolean; force?: boolean; forceFrom?: string }

const JOBS: Record<string, (opts?: JobOptions) => Promise<JobResult>> = {
  'fetch-prices': fetchPricesJob,
  'fetch-balances': fetchBalancesJob,
  'fetch-transactions': fetchTransactionsJob,
  'fetch-qb-reports': fetchQbReportsJob,
  'refresh-qb-tokens': refreshQbTokensJob,
  'prune-cache': pruneCacheJob,
}

function usage(): never {
  console.error(
    `usage: bun run cron <job-name> [--full] [--force [--from=YYYY-MM]]\n\n`
    + `available jobs:\n  ${Object.keys(JOBS).join('\n  ')}\n\n`
    + `flags:\n`
    + `  --full            (fetch-transactions only) drain full wallet history\n`
    + `  --force           (fetch-qb-reports only) delete cached rows in range, then re-fetch\n`
    + `  --from=YYYY-MM    (with --force) earliest month to re-fetch; default ${CRON_HISTORY_START}`,
  )
  process.exit(2)
}

async function confirmProd(databaseUrl: string, forceFrom: string): Promise<boolean> {
  const host = new URL(databaseUrl).hostname
  console.error(`[cron] TARGET: ${host}`)
  console.error(`[cron] Will DELETE cached rows with period_start >= ${forceFrom}-01 and re-fetch from QuickBooks.`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`Type 'force' to proceed: `)
    return answer.trim() === 'force'
  } finally {
    rl.close()
  }
}

async function main() {
  const parsed = parseCronArgs(process.argv)
  if (!parsed.ok) {
    console.error(parsed.error)
    usage()
  }

  const job = JOBS[parsed.name]
  if (!job) {
    console.error(`unknown job: ${parsed.name}`)
    usage()
  }

  if (parsed.force && parsed.name !== 'fetch-qb-reports') {
    console.error(`--force is only supported for fetch-qb-reports (got: ${parsed.name})`)
    process.exit(2)
  }

  const forceFrom = parsed.force ? (parsed.forceFrom ?? CRON_HISTORY_START) : undefined

  if (parsed.force && looksLikeProd(process.env.DATABASE_URL)) {
    const confirmed = await confirmProd(process.env.DATABASE_URL!, forceFrom!)
    if (!confirmed) {
      console.error('[cron] aborted')
      process.exit(0)
    }
  }

  const startedAt = Date.now()
  try {
    const result = await job({ full: parsed.full, force: parsed.force, forceFrom })
    const durationMs = Date.now() - startedAt
    await logAudit({
      action: `cron.${parsed.name}.succeeded`,
      metadata: { durationMs, force: parsed.force, forceFrom, ...result },
    }).catch(() => {})
    console.log(JSON.stringify({ job: parsed.name, durationMs, ...result }, null, 2))
    process.exit(0)
  } catch (err) {
    const msg = (err as Error).message
    const durationMs = Date.now() - startedAt
    await logAudit({
      action: `cron.${parsed.name}.failed`,
      metadata: { durationMs, force: parsed.force, forceFrom, error: msg },
    }).catch(() => {})
    console.error(`[cron.${parsed.name}] failed after ${durationMs}ms: ${msg}`)
    process.exit(1)
  }
}

await main()
