import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { hasPermission } from '@/lib/auth/permissions'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import { markApprovalPaid, isFinancePoolMember } from '@/lib/approvals/service'

export const runtime = 'nodejs'

/**
 * POST /api/approvals/[id]/pay
 * Body: { paymentReference: string }  — tx hash, wire confirmation, Mercury ref…
 * Only approved requests can be marked paid. Payments are executed by the
 * finance pool: admins, plus non-admin users marked as Finance approver in
 * Access Control.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny
  const { id } = await params

  if (!hasPermission(actor.role, 'approvals:approve') && !(await isFinancePoolMember(actor.id))) {
    return NextResponse.json({ error: 'Only the finance team can mark requests as paid' }, { status: 403 })
  }

  let body: { paymentReference?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const paymentReference = typeof body.paymentReference === 'string' ? body.paymentReference.trim() : ''
  if (!paymentReference) {
    return NextResponse.json({ error: 'paymentReference is required (tx hash / wire ref)' }, { status: 400 })
  }

  try {
    const updated = await markApprovalPaid(
      { id: actor.id, email: actor.email },
      id,
      paymentReference,
      getSoxRequestContext(req),
    )
    return NextResponse.json({ ok: true, request: updated })
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 })
  }
}
