// POST /api/qb/post-batch
//   Body: { entity: QboEntity, txIds: string[] }
//
// Posts the selected tidelog transactions to QuickBooks as journal entries.
// Hard-capped at 50 tx IDs per call (D13) — UI is also capped client-side, but
// this is the defense-in-depth check. Partial failures are isolated per-JE
// (see lib/qb/post-batch.ts for the orchestration). All posts/voids/failures
// go through logAudit().

import { NextRequest, NextResponse, after } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { preparePostBatch, runJobsBackground } from '@/lib/qb/post-batch'
import { isQboEntity } from '@/lib/qb/config'
import { logAudit } from '@/lib/audit'

// Caps mirror lib/qb/post-batch.ts: up to 1000 selected txs per call, but
// never more than 50 JOURNAL ENTRIES (QB API calls) — bulk-treasury wallets
// group a month of txs into one JE, which is what makes big selections safe.
const MAX_BATCH_SIZE = 1000
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { user, deny } = await requirePermission('qb:post', req)
  if (deny) return deny

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected object' }, { status: 400 })
  }
  const b = body as { entity?: unknown; txIds?: unknown }

  if (typeof b.entity !== 'string' || !isQboEntity(b.entity)) {
    return NextResponse.json(
      { error: 'entity required (valid QboEntity)' },
      { status: 400 },
    )
  }
  if (
    !Array.isArray(b.txIds) ||
    b.txIds.length === 0 ||
    !b.txIds.every((x) => typeof x === 'string')
  ) {
    return NextResponse.json(
      { error: 'txIds required (non-empty string array)' },
      { status: 400 },
    )
  }
  if (b.txIds.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `batch size exceeds ${MAX_BATCH_SIZE} — post in smaller groups` },
      { status: 400 },
    )
  }

  try {
    // Reserve + build the JEs synchronously (fast: DB + local only), then fire
    // them at QuickBooks in the BACKGROUND via after(). QB now takes minutes to
    // create a JE, so the request returns immediately with the reserved entries
    // as 'pending'; the background worker POSTs each (idempotent Request-Id) and
    // flips them to posted once QB confirms — the user never waits on QB.
    const { jobs, ...result } = await preparePostBatch({
      entity: b.entity,
      txIds: b.txIds as string[],
      userId: user!.id,
    })

    if (jobs.length > 0) {
      const userId = user!.id
      after(async () => { await runJobsBackground(jobs, userId).catch(() => { /* logged per-job */ }) })
    }

    logAudit({
      userId: user!.id,
      action: 'qb_post.batch',
      resourceType: 'qb_post',
      metadata: {
        entity: b.entity,
        attempted: (b.txIds as string[]).length,
        reserved: jobs.length,
        failed: result.failures.length,
        skipped: result.skipped.length,
      },
    }).catch(() => {
      /* swallow */
    })

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Post failed'
    // Distinguish 403 (entity ownership violation), 400 (JE-group cap and
    // batch-size validation thrown by buildPostPlan) and 500 (everything
    // else).
    const status = msg.startsWith('Forbidden')
      ? 403
      : msg.startsWith('Selection would create') || msg.startsWith('Batch size exceeds')
        ? 400
        : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
