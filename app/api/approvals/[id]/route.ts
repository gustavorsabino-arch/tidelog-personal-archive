import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { approvalRequest, approvalAttachment, user } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { hasPermission } from '@/lib/auth/permissions'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import { recordApprovalView } from '@/lib/approvals/service'

export const runtime = 'nodejs'

/**
 * GET /api/approvals/[id] — request detail + attachment metadata (no bytes).
 * Visible to: the submitter, and anyone with approvals:admin.
 *
 * SOX: when the viewer holds approvals:approve, is NOT the submitter, and
 * the request is pending, an 'approval.viewed' audit row is recorded
 * (debounced 10 min). The decide endpoint later uses the latest viewed row
 * to compute the tamper-resistant server-side review duration.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny
  const { id } = await params

  const [row] = await db
    .select({
      request: approvalRequest,
      submitterEmail: user.email,
    })
    .from(approvalRequest)
    .leftJoin(user, eq(approvalRequest.submitterId, user.id))
    .where(eq(approvalRequest.id, id))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = hasPermission(actor.role, 'approvals:admin')
  const isSubmitter = row.request.submitterId === actor.id
  if (!isAdmin && !isSubmitter) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const attachments = await db
    .select({
      id: approvalAttachment.id,
      filename: approvalAttachment.filename,
      contentType: approvalAttachment.contentType,
      sizeBytes: approvalAttachment.sizeBytes,
      sha256: approvalAttachment.sha256,
      uploadedAt: approvalAttachment.uploadedAt,
    })
    .from(approvalAttachment)
    .where(eq(approvalAttachment.requestId, id))

  // Record the review-view for eligible approvers (never for the submitter
  // looking at their own request — that's not a review).
  const canApprove = hasPermission(actor.role, 'approvals:approve')
  if (canApprove && !isSubmitter && row.request.status === 'pending') {
    await recordApprovalView(
      { id: actor.id, email: actor.email },
      id,
      getSoxRequestContext(req),
    ).catch(() => {}) // view-tracking must never block the read
  }

  return NextResponse.json({
    request: { ...row.request, submitterEmail: row.submitterEmail },
    attachments,
    viewer: {
      isAdmin,
      isSubmitter,
      canDecide: canApprove && !isSubmitter && row.request.status === 'pending',
      canPay: canApprove && row.request.status === 'approved',
      canCancel: isSubmitter && row.request.status === 'pending',
    },
  })
}
