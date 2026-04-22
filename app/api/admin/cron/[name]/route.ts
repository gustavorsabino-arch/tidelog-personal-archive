import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { fetchPricesJob } from '@/lib/cron/fetch-prices'
import { fetchBalancesJob } from '@/lib/cron/fetch-balances'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'
import { fetchQbReportsJob } from '@/lib/cron/fetch-qb-reports'
import { refreshQbTokensJob } from '@/lib/cron/refresh-qb-tokens'
import { pruneCacheJob } from '@/lib/cron/prune-cache'

const JOBS: Record<string, () => Promise<unknown>> = {
  'fetch-prices': fetchPricesJob,
  'fetch-balances': fetchBalancesJob,
  'fetch-transactions': fetchTransactionsJob,
  'fetch-qb-reports': fetchQbReportsJob,
  'refresh-qb-tokens': refreshQbTokensJob,
  'prune-cache': pruneCacheJob,
}

/**
 * Admin-only manual trigger for any cron job. Useful for backfills after
 * config changes. Writes an audit entry and then delegates to the same job
 * function the scheduler calls.
 */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const { name } = await params
  const job = JOBS[name]
  if (!job) {
    return NextResponse.json(
      { error: 'Unknown cron job', code: 'cron.unknown', known: Object.keys(JOBS) },
      { status: 404 },
    )
  }

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: `cron.${name}.triggered-manual`,
    metadata: { byEmail: user.email },
  })

  try {
    const result = await job()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message, code: 'cron.failed' },
      { status: 500 },
    )
  }
}
