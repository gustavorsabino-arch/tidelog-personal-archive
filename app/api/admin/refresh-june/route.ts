import { NextResponse, after } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { fetchQbReportsJob } from '@/lib/cron/fetch-qb-reports'

/**
 * GET /api/admin/refresh-june
 *
 * Convenience wrapper around fetchQbReportsJob that force-refreshes QB
 * reports from June 2026 forward for all connected entities. Returns 202
 * immediately and runs the job in the background (job typically takes
 * 5-10 min; Vercel keeps the function alive up to maxDuration).
 *
 * If a specific entity's QB tokens are actually expired, the job logs
 * that entity's failure to audit + console — check Vercel logs / audit
 * table after the job finishes to see per-entity outcomes.
 *
 * Auth: admin:manage_data. Just open the URL as admin.
 */
export const maxDuration = 800

export async function GET(req: Request) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const fromPeriod = '2026-06'
  const startedAt = Date.now()

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'admin.refresh_june.started',
    resourceType: 'qb_report_cache',
    resourceId: fromPeriod,
    metadata: { fromPeriod, byEmail: user.email },
  }).catch(() => {})

  after(async () => {
    try {
      const result = await fetchQbReportsJob({
        force: true,
        forceFrom: fromPeriod,
        accountScope: 'budget-mapped',
      })
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'admin.refresh_june.succeeded',
        resourceType: 'qb_report_cache',
        resourceId: fromPeriod,
        metadata: { fromPeriod, byEmail: user.email, durationMs: Date.now() - startedAt, result },
      }).catch(() => {})
    } catch (err) {
      const message = (err as Error).message
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'admin.refresh_june.failed',
        resourceType: 'qb_report_cache',
        resourceId: fromPeriod,
        metadata: { fromPeriod, byEmail: user.email, durationMs: Date.now() - startedAt, error: message },
      }).catch(() => {})
    }
  })

  return NextResponse.json({
    ok: true,
    status: 'started',
    fromPeriod,
    note: 'Job running in background. Refresh /budget in ~5-10 min to see updated Zagreus (and other entities) actuals.',
  }, { status: 202 })
}
