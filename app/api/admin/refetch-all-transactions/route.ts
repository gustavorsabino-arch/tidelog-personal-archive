import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'

/**
 * GET /api/admin/refetch-all-transactions
 *
 * Runs fetchTransactionsJob() for EVERY internal, non-hidden wallet in the
 * registry — the same call the Vercel cron makes (see
 * app/api/cron/fetch-transactions/route.ts + lib/cron/runner.ts).
 *
 * Purpose: manual fallback when the periodic cron falls behind. The user
 * opens this URL, waits ~30-60s, and every wallet catches up incrementally
 * with new on-chain transactions since its most recent DB row.
 *
 * Auth: admin:manage_data (not the CRON_SECRET bearer the cron uses — this
 * endpoint is triggered by an authenticated admin session instead).
 *
 * Returns:
 *   { ok, wallets, inserted, failed, mode: 'incremental', elapsedMs, results }
 */
export const maxDuration = 300

export async function GET(req: Request) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const startedAt = Date.now()
  try {
    const result = await fetchTransactionsJob()
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'admin.refetch_all_transactions.succeeded',
      resourceType: 'transaction',
      resourceId: 'all',
      metadata: {
        byEmail: user.email,
        durationMs: Date.now() - startedAt,
        inserted: result.inserted,
        wallets: result.wallets,
        failed: result.failed,
      },
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      wallets: result.wallets,
      inserted: result.inserted,
      failed: result.failed,
      mode: result.mode,
      elapsedMs: result.elapsedMs,
      results: result.results,
    })
  } catch (err) {
    const message = (err as Error).message
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'admin.refetch_all_transactions.failed',
      resourceType: 'transaction',
      resourceId: 'all',
      metadata: {
        byEmail: user.email,
        durationMs: Date.now() - startedAt,
        error: message,
      },
    }).catch(() => {})
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
