import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

export type JobResult = { ok: boolean; [k: string]: unknown }

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Shared wrapper for every cron route handler.
 * - Verifies Authorization: Bearer <CRON_SECRET> (constant-time compare)
 * - Runs the job
 * - Writes an audit_log entry (succeeded / failed)
 * - Returns JSON with elapsed duration
 *
 * Handlers are thin:
 *   export const GET = (req: Request) => runCron('fetch-balances', req, fetchBalancesJob)
 */
export async function runCron(
  name: string,
  request: Request,
  job: () => Promise<JobResult>,
): Promise<Response> {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured', code: 'cron.misconfigured' },
      { status: 500 },
    )
  }

  const auth = request.headers.get('authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!provided || !constantTimeEquals(provided, expected)) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'cron.unauthorized' },
      { status: 401 },
    )
  }

  const startedAt = Date.now()
  try {
    const result = await job()
    await logAudit({
      action: `cron.${name}.${result.ok ? 'succeeded' : 'failed'}`,
      metadata: { durationMs: Date.now() - startedAt, ...result },
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (err) {
    const msg = (err as Error).message
    await logAudit({
      action: `cron.${name}.failed`,
      metadata: { durationMs: Date.now() - startedAt, error: msg },
    })
    return NextResponse.json(
      { ok: false, error: msg, code: 'cron.failed' },
      { status: 500 },
    )
  }
}
