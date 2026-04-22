import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { cancelForceRun } from '@/lib/qb/force-refresh'

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

  const runId = (body as { runId?: unknown })?.runId
  if (typeof runId !== 'string' || !runId) {
    return NextResponse.json(
      { error: 'runId is required', code: 'validation.failed' },
      { status: 400 },
    )
  }

  const result = await cancelForceRun({ runId, requesterEmail: user.email })
  if (result.ok) {
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'cron.fetch-qb-reports.force.canceled',
      resourceType: 'qb_force_refresh_run',
      resourceId: runId,
      metadata: { byEmail: user.email, fromPeriod: result.run.fromPeriod },
    }).catch(() => {})
    return NextResponse.json({ run: result.run })
  }

  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'Run not found', code: 'force_refresh.not_found' },
      { status: 404 },
    )
  }
  if (result.reason === 'not_running') {
    return NextResponse.json(
      {
        error: `Cannot cancel a run in state '${result.run.status}'`,
        code: 'force_refresh.not_running',
        status: result.run.status,
      },
      { status: 409 },
    )
  }
  // not_owner
  return NextResponse.json(
    {
      error: 'Only the user who started this run can cancel it',
      code: 'force_refresh.not_owner',
      requestedBy: result.run.requestedByEmail,
    },
    { status: 403 },
  )
}
