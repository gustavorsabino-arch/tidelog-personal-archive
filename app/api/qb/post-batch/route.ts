// POST /api/qb/post-batch
//   Body: { entity: QboEntity, txIds: string[] }
//
// Posts the selected tidelog transactions to QuickBooks as journal entries.
// Hard-capped at 50 tx IDs per call (D13) — UI is also capped client-side, but
// this is the defense-in-depth check. Partial failures are isolated per-JE
// (see lib/qb/post-batch.ts for the orchestration). All posts/voids/failures
// go through logAudit().

import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { postBatch } from '@/lib/qb/post-batch'
import { isQboEntity } from '@/lib/qb/config'
import { logAudit } from '@/lib/audit'

const MAX_BATCH_SIZE = 50

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
    const result = await postBatch({
      entity: b.entity,
      txIds: b.txIds as string[],
      userId: user!.id,
    })

    // Batch-level audit. Per-JE successes/failures are also logged inside
    // post-batch.ts; this row gives forensics a single entry per batch.
    logAudit({
      userId: user!.id,
      action: 'qb_post.batch',
      resourceType: 'qb_post',
      metadata: {
        entity: b.entity,
        attempted: (b.txIds as string[]).length,
        succeeded: result.successes.length,
        failed: result.failures.length,
        skipped: result.skipped.length,
      },
    }).catch(() => {
      /* swallow */
    })

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Post failed'
    // Distinguish 403 (entity ownership violation, thrown by buildPostPlan)
    // from 500 (everything else). 400-style validation errors are caught
    // before this try/catch above.
    const status = msg.startsWith('Forbidden') ? 403 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
