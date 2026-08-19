import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { approvalRequest, approvalAttachment, approvalAssignee, approvalDecision, user } from '@/lib/db/schema'
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

  // Approver panel: assignee snapshot + each one's vote (if cast).
  const assignees = await db
    .select({ userId: approvalAssignee.userId, email: approvalAssignee.email })
    .from(approvalAssignee)
    .where(eq(approvalAssignee.requestId, id))
  const votes = await db
    .select({
      approverId: approvalDecision.approverId,
      decision: approvalDecision.decision,
      note: approvalDecision.note,
      decidedAt: approvalDecision.decidedAt,
    })
    .from(approvalDecision)
    .where(eq(approvalDecision.requestId, id))
  const voteById = new Map(votes.map((v) => [v.approverId, v]))
  const approvers = assignees.map((a) => {
    const vote = voteById.get(a.userId)
    return {
      email: a.email,
      state: (vote ? vote.decision : 'pending') as 'approved' | 'rejected' | 'pending',
      note: vote?.note ?? null,
      decidedAt: vote?.decidedAt ?? null,
    }
  })

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

  // Multi-approver requests: only an assignee who hasn't voted may decide.
  // Legacy (assignee-less) requests keep the V1 rule: any approver but the
  // submitter.
  const isAssignee = assignees.some((a) => a.userId === actor.id)
  const hasVoted = voteById.has(actor.id)
  const canDecide = canApprove && !isSubmitter && row.request.status === 'pending'
    && (assignees.length === 0 || (isAssignee && !hasVoted))

  return NextResponse.json({
    request: { ...row.request, submitterEmail: row.submitterEmail },
    attachments,
    approvers,
    viewer: {
      isAdmin,
      isSubmitter,
      canDecide,
      canPay: canApprove && row.request.status === 'approved',
      canCancel: isSubmitter && row.request.status === 'pending',
    },
  })
}
