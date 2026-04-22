#!/usr/bin/env bun
/**
 * CLI runner for cron jobs.
 *
 * Usage:
 *   bun run cron <job-name>
 *
 * Where job-name is one of:
 *   fetch-prices
 *   fetch-balances
 *   fetch-transactions
 *   fetch-qb-reports
 *   refresh-qb-tokens
 *   prune-cache
 *
 * The script resolves the job's exported function, runs it, writes an
 * audit_log row (same schema as the HTTP runner), prints the result to
 * stdout, and exits 0 on success or 1 on failure. Designed to be called
 * directly by Dokploy scheduled tasks without an HTTP indirection.
 */

import { logAudit } from '@/lib/audit'
import { fetchBalancesJob } from '@/lib/cron/fetch-balances'
import { fetchPricesJob } from '@/lib/cron/fetch-prices'
import { fetchQbReportsJob } from '@/lib/cron/fetch-qb-reports'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'
import { pruneCacheJob } from '@/lib/cron/prune-cache'
import { refreshQbTokensJob } from '@/lib/cron/refresh-qb-tokens'

type JobResult = { ok: boolean; [k: string]: unknown }

const JOBS: Record<string, (opts?: { full?: boolean }) => Promise<JobResult>> = {
  'fetch-prices': fetchPricesJob,
  'fetch-balances': fetchBalancesJob,
  'fetch-transactions': fetchTransactionsJob,
  'fetch-qb-reports': fetchQbReportsJob,
  'refresh-qb-tokens': refreshQbTokensJob,
  'prune-cache': pruneCacheJob,
}

function usage(): never {
  console.error(`usage: bun run cron <job-name> [--full]\n\navailable jobs:\n  ${Object.keys(JOBS).join('\n  ')}\n\nflags:\n  --full  (fetch-transactions only) drain full wallet history, not just incremental`)
  process.exit(2)
}

async function main() {
  const name = process.argv[2]
  if (!name) usage()
  const job = JOBS[name]
  if (!job) {
    console.error(`unknown job: ${name}`)
    usage()
  }
  const full = process.argv.includes('--full')

  const startedAt = Date.now()
  try {
    const result = await job({ full })
    const durationMs = Date.now() - startedAt
    await logAudit({
      action: `cron.${name}.succeeded`,
      metadata: { durationMs, ...result },
    }).catch(() => {})
    console.log(JSON.stringify({ job: name, durationMs, ...result }, null, 2))
    process.exit(0)
  } catch (err) {
    const msg = (err as Error).message
    const durationMs = Date.now() - startedAt
    await logAudit({
      action: `cron.${name}.failed`,
      metadata: { durationMs, error: msg },
    }).catch(() => {})
    console.error(`[cron.${name}] failed after ${durationMs}ms: ${msg}`)
    process.exit(1)
  }
}

await main()
