import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { approvalRequest, approvalAttachment, approvalLink, approvalAssignee, approvalDecision, user } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { hasPermission } from '@/lib/auth/permissions'
import { ensureApprovalsSchema } from '@/lib/db/approvals-schema'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import { recordApprovalView, isFinancePoolMember } from '@/lib/approvals/service'

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

  // Self-heal pending schema before touching the new columns.
  await ensureApprovalsSchema().catch(() => {})

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

  // Assignee snapshot + votes first — assignees (incl. budget_viewer
  // department heads) are allowed to see requests they must decide on.
  const assignees = await db
    .select({ userId: approvalAssignee.userId, email: approvalAssignee.email, stage: approvalAssignee.stage })
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

  const isAdmin = hasPermission(actor.role, 'approvals:admin')
  const isSubmitter = row.request.submitterId === actor.id
  const isAssignee = assignees.some((a) => a.userId === actor.id)
  if (!isAdmin && !isSubmitter && !isAssignee) {
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

  const links = await db
    .select({
      id: approvalLink.id,
      url: approvalLink.url,
      label: approvalLink.label,
      addedAt: approvalLink.addedAt,
    })
    .from(approvalLink)
    .where(eq(approvalLink.requestId, id))

  // Approver panel: each assignee with their stage + vote (if cast).
  const voteById = new Map(votes.map((v) => [v.approverId, v]))
  const approvers = assignees.map((a) => {
    const vote = voteById.get(a.userId)
    return {
      email: a.email,
      stage: a.stage,
      state: (vote ? vote.decision : 'pending') as 'approved' | 'rejected' | 'pending',
      note: vote?.note ?? null,
      decidedAt: vote?.decidedAt ?? null,
    }
  })

  // Record the review-view for eligible approvers (never for the submitter
  // looking at their own request — that's not a review).
  const canApprove = hasPermission(actor.role, 'approvals:approve')
  if ((canApprove || isAssignee) && !isSubmitter && row.request.status === 'pending') {
    await recordApprovalView(
      { id: actor.id, email: actor.email },
      id,
      getSoxRequestContext(req),
    ).catch(() => {}) // view-tracking must never block the read
  }

  // Stage-aware decide eligibility — mirrors the service's enforcement:
  //  - REJECTING is never stage-gated: any un-voted assignee of a pending
  //    request can veto it at any moment (canDecide)
  //  - APPROVING follows the stage order: heads while the head stage is
  //    open, finance only after it's satisfied (canApproveNow)
  //  - pre-matrix multi-approver rows: any assignee who hasn't voted
  //  - legacy assignee-less rows: any admin but the submitter
  const requiredHead = row.request.requiredHeadApprovals ?? 0
  const requiredFinance = row.request.requiredFinanceApprovals
  const headIds = new Set(assignees.filter((a) => a.stage === 'head').map((a) => a.userId))
  const headApproved = votes.filter((v) => v.decision === 'approved' && headIds.has(v.approverId)).length
  const headSatisfied = requiredHead === 0 || headApproved >= requiredHead
  const me = assignees.find((a) => a.userId === actor.id)
  const hasVoted = voteById.has(actor.id)

  let canDecide = false
  let canApproveNow = false
  if (row.request.status === 'pending' && !isSubmitter) {
    if (assignees.length === 0) {
      canDecide = canApprove
      canApproveNow = canApprove
    } else if (me && !hasVoted) {
      canDecide = true
      canApproveNow = requiredFinance === null
        ? true
        : me.stage === 'head' ? !headSatisfied : headSatisfied
    }
  }

  return NextResponse.json({
    request: { ...row.request, submitterEmail: row.submitterEmail },
    attachments,
    links,
    approvers,
    stageState: { headSatisfied, headApproved, requiredHead, requiredFinance },
    viewer: {
      canAddEvidence: (isSubmitter || isAdmin)
        && row.request.status !== 'rejected' && row.request.status !== 'cancelled',
      isAdmin,
      isSubmitter,
      canDecide,
      canApproveNow,
      // Payments are executed by the finance pool: admins plus non-admin
      // Finance approvers from Access Control.
      canPay: row.request.status === 'approved'
        && (canApprove || await isFinancePoolMember(actor.id)),
      // Admins may cancel anyone's pending request — the liveness escape
      // when a snapshotted approver has left the company.
      canCancel: (isSubmitter || isAdmin) && row.request.status === 'pending',
    },
  })
}
