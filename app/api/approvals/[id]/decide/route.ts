import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import { decideApprovalRequest } from '@/lib/approvals/service'

export const runtime = 'nodejs'

/**
 * POST /api/approvals/[id]/decide
 * Body: { decision: 'approved' | 'rejected', note?: string, clientReviewMs?: number }
 *
 * SOX guarantees enforced here + in the service layer:
 *  - approvals:approve permission required (admin-only in V1)
 *  - submitter can never decide their own request (endpoint + DB CHECK)
 *  - decision + audit row commit in one transaction
 *  - server-side review duration computed from the 'approval.viewed' trail
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user: actor, deny } = await requirePermission('approvals:approve', req)
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
    )
    return NextResponse.json({ ok: true, request: updated })
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 })
  }
}
