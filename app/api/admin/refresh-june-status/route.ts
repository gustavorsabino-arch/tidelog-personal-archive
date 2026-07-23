import { NextResponse } from 'next/server'
import { desc, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'

/**
 * GET /api/admin/refresh-june-status
 *
 * Reads the last few audit_log entries for the refresh-june job and
 * returns a compact status blob. Poll this URL every minute to see if
 * the background job started/succeeded/failed and the per-entity result.
 *
 * Auth: admin:manage_data.
 */
export async function GET(req: Request) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const rows = await db
    .select()
    .from(auditLog)
    .where(inArray(auditLog.action, [
      'admin.refresh_june.started',
      'admin.refresh_june.succeeded',
      'admin.refresh_june.failed',
    ]))
    .orderBy(desc(auditLog.createdAt))
    .limit(5)

  if (rows.length === 0) {
    return NextResponse.json({
      status: 'never_run',
      note: 'No refresh-june runs found in audit_log. Hit /api/admin/refresh-june to start one.',
    })
  }

  // Find latest started + whether it has a matching succeeded/failed after it.
  const latestStarted = rows.find(r => r.action === 'admin.refresh_june.started')
  const latestSucceeded = rows.find(r => r.action === 'admin.refresh_june.succeeded')
  const latestFailed = rows.find(r => r.action === 'admin.refresh_june.failed')

  let currentStatus: 'idle' | 'running' | 'succeeded' | 'failed' = 'idle'
  let sinceMs: number | null = null

  if (latestStarted) {
    const startedAt = latestStarted.createdAt.getTime()
    const succeededAfter = latestSucceeded && latestSucceeded.createdAt.getTime() > startedAt
    const failedAfter = latestFailed && latestFailed.createdAt.getTime() > startedAt
    if (succeededAfter) {
      currentStatus = 'succeeded'
      sinceMs = Date.now() - latestSucceeded!.createdAt.getTime()
    } else if (failedAfter) {
      currentStatus = 'failed'
      sinceMs = Date.now() - latestFailed!.createdAt.getTime()
    } else {
      currentStatus = 'running'
      sinceMs = Date.now() - startedAt
    }
  }

  const formatAgo = (ms: number | null) => {
    if (ms == null) return null
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s ago`
    return `${Math.floor(s / 60)}m ${s % 60}s ago`
  }

  return NextResponse.json({
    status: currentStatus,
    since: formatAgo(sinceMs),
    latestStartedAt: latestStarted?.createdAt.toISOString() ?? null,
    latestSucceededAt: latestSucceeded?.createdAt.toISOString() ?? null,
    latestFailedAt: latestFailed?.createdAt.toISOString() ?? null,
    // metadata payloads (per-entity result / error) — most useful bit
    latestSuccessResult: (latestSucceeded?.metadata as Record<string, unknown> | undefined)?.result ?? null,
    latestFailureError: (latestFailed?.metadata as Record<string, unknown> | undefined)?.error ?? null,
  })
}
