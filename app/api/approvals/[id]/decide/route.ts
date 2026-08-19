import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { hasPermission } from '@/lib/auth/permissions'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import { decideApprovalRequest } from '@/lib/approvals/service'

export const runtime = 'nodejs'

/**
 * POST /api/approvals/[id]/decide
 * Body: { decision: 'approved' | 'rejected', note?: string, clientReviewMs?: number }
 *
 * Gate is approvals:submit (so budget_viewer department heads can cast
 * their head-stage vote) — the SERVICE enforces the real authority: the
 * actor must be a snapshotted assignee of this request, in the right
 * stage, who hasn't voted. Legacy assignee-less requests still require the
 * full approvals:approve permission (admin), passed as actorCanApproveAll.
 *
 * SOX guarantees enforced here + in the service layer:
 *  - submitter can never decide their own request (endpoint + DB CHECK)
 *  - decision + audit row commit in one transaction
 *  - server-side review duration computed from the 'approval.viewed' trail
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny
  const { id } = await params

  let body: { decision?: string; note?: string; clientReviewMs?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
  if (body.decision === 'rejected' && !note) {
    return NextResponse.json({ error: 'A note explaining the rejection is required' }, { status: 400 })
  }
  const clientReviewMs = Number.isFinite(body.clientReviewMs) && (body.clientReviewMs as number) >= 0
    ? Math.round(body.clientReviewMs as number)
    : null

  try {
    const updated = await decideApprovalRequest(
      { id: actor.id, email: actor.email },
      id,
      body.decision,
      note,
      clientReviewMs,
      getSoxRequestContext(req),
      hasPermission(actor.role, 'approvals:approve'),
    )
    return NextResponse.json({ ok: true, request: updated })
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 })
  }
}
