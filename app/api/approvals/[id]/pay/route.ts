import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import { markApprovalPaid } from '@/lib/approvals/service'

export const runtime = 'nodejs'

/**
 * POST /api/approvals/[id]/pay
 * Body: { paymentReference: string }  — tx hash, wire confirmation, Mercury ref…
 * Only approved requests can be marked paid. Requires approvals:approve.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user: actor, deny } = await requirePermission('approvals:approve', req)
  if (deny) return deny
  const { id } = await params

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
