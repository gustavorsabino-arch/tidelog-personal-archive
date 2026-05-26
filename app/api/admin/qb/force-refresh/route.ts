import { NextResponse, after } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { ForceRefreshCanceledError, fetchQbReportsJob } from '@/lib/cron/fetch-qb-reports'
import {
  FORCE_REFRESH_HISTORY_START,
  completeForceRun,
  createForceRun,
  failForceRun,
  isRunCanceled,
  listRecentForceRuns,
  parseFromPeriod,
  updateForceRunEntityProgress,
} from '@/lib/qb/force-refresh'

/**
 * Vercel Pro supports up to 900s. The force-refresh job fetches all QB
 * reports + transaction payloads for the requested range and typically takes
 * 5-10 minutes on a well-populated tenant; long from-period ranges (e.g.
 * 2026-01) need the full 900s budget to complete reconcile + completeForceRun.
 */
export const maxDuration = 900

export async function GET(req: Request) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const runs = await listRecentForceRuns(20)
  return NextResponse.json({ runs })
}

export async function POST(req: Request) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'validation.failed' },
      { status: 400 },
    )
  }

  const fromInput = (body as { from?: unknown })?.from ?? FORCE_REFRESH_HISTORY_START
  const fromParsed = parseFromPeriod(fromInput)
  if (!fromParsed.ok) {
    return NextResponse.json(
      { error: fromParsed.error, code: 'force_refresh.invalid_from' },
      { status: 400 },
    )
  }
  const fromPeriod = fromParsed.value

  const created = await createForceRun({ fromPeriod, requestedByEmail: user.email })
  if (!created.ok) {
    return NextResponse.json(
      {
        error: 'A force refresh is already in progress',
        code: 'force_refresh.already_running',
        existing: {
          id: created.existing.id,
          fromPeriod: created.existing.fromPeriod,
          startedAt: created.existing.startedAt,
          requestedByEmail: created.existing.requestedByEmail,
        },
      },
      { status: 409 },
    )
  }
  const run = created.run

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'cron.fetch-qb-reports.force.started',
    resourceType: 'qb_force_refresh_run',
    resourceId: run.id,
    metadata: { fromPeriod, byEmail: user.email },
  }).catch(() => {})

  // Run the actual job after the 202 response is flushed. Vercel keeps the
  // function alive until this finishes or maxDuration elapses.
  after(async () => {
    const startedAtMs = Date.now()
    try {
      const result = await fetchQbReportsJob({
        force: true,
        forceFrom: fromPeriod,
        shouldAbort: () => isRunCanceled(run.id),
        onEntityProgress: (entityId, entityResult) =>
          updateForceRunEntityProgress(run.id, entityId, entityResult),
      })
      await completeForceRun(run.id, result)
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'cron.fetch-qb-reports.force.succeeded',
        resourceType: 'qb_force_refresh_run',
        resourceId: run.id,
        metadata: {
          fromPeriod,
          byEmail: user.email,
          durationMs: Date.now() - startedAtMs,
          ...result,
        },
      }).catch(() => {})
    } catch (err) {
      if (err instanceof ForceRefreshCanceledError) {
        // The cancel endpoint already transitioned the row to 'canceled'
        // and wrote an audit row. Nothing more to do here.
        return
      }
      const message = (err as Error).message
      await failForceRun(run.id, message).catch(() => {})
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'cron.fetch-qb-reports.force.failed',
        resourceType: 'qb_force_refresh_run',
        resourceId: run.id,
        metadata: {
          fromPeriod,
          byEmail: user.email,
          durationMs: Date.now() - startedAtMs,
          error: message,
        },
      }).catch(() => {})
    }
  })

  return NextResponse.json(
    { runId: run.id, startedAt: run.startedAt, fromPeriod },
    { status: 202 },
  )
}
