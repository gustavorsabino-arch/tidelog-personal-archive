import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { hasPermission } from '@/lib/auth/permissions'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import { cancelApprovalRequest } from '@/lib/approvals/service'

export const runtime = 'nodejs'

/**
 * POST /api/approvals/[id]/cancel — submitter withdraws their own PENDING
 * request; an approvals:admin may cancel anyone's pending request (audit
 * action 'approval.cancelled_by_admin'). Terminal; audit-logged.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny
  const { id } = await params

  try {
    const updated = await cancelApprovalRequest(
      { id: actor.id, email: actor.email },
      id,
      getSoxRequestContext(req),
      hasPermission(actor.role, 'approvals:admin'),
    )
    return NextResponse.json({ ok: true, request: updated })
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 })
  }
}
