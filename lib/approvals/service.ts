import { createHash } from 'node:crypto'
import { and, desc, eq, gte, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { approvalRequest, approvalAttachment, approvalAssignee, approvalDecision, auditLog, user } from '@/lib/db/schema'
import type { SoxRequestContext } from './request-context'

/**
 * Business logic for the Approvals workflow. All state-changing operations
 * write their audit row IN THE SAME TRANSACTION as the mutation — SOX wants
 * the trail to be as durable as the action itself (lib/audit.ts's logAudit
 * deliberately swallows failures, which is fine for access-denied noise but
 * not for approval decisions). audit_log is append-only (Postgres trigger
 * rejects UPDATE/DELETE — scripts/apply-triggers.ts).
 */

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'paid', 'cancelled'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export const PAYMENT_TYPES = ['wire', 'ach', 'crypto', 'card', 'check', 'other'] as const
export type PaymentType = (typeof PAYMENT_TYPES)[number]

export const REQUEST_TYPES = ['payment', 'funding'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

export const FUNDING_NETWORKS = ['ethereum', 'solana', 'tron'] as const
export type FundingNetwork = (typeof FUNDING_NETWORKS)[number]

export const FUNDING_TOKENS = ['USDC', 'USDT', 'ORCA', 'SOL', 'ETH'] as const
export type FundingToken = (typeof FUNDING_TOKENS)[number]

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024   // 4 MB per file (Vercel body budget)
export const MAX_ATTACHMENTS_PER_REQUEST = 5

export type NewApprovalRequestInput = {
  requestType?: RequestType    // defaults to 'payment'
  vendorName: string
  description?: string | null
  amount: number
  currency?: string
  invoiceNumber?: string | null
  invoiceDate?: string | null   // YYYY-MM-DD
  dueDate?: string | null       // YYYY-MM-DD
  glAccount?: string | null
  department?: string | null
  entity?: string | null
  paymentType?: PaymentType | null
  // Funding-only (wallet top-up)
  network?: FundingNetwork | null
  token?: FundingToken | null
  walletAddress?: string | null
}

export type NewAttachmentInput = {
  filename: string
  contentType: string
  bytes: Buffer
}

type Actor = { id: string; email: string }

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// APR-<zero-padded sequence>. Uses a count-based next number inside the
// insert transaction; the UNIQUE constraint on ref_number turns any race
// into a retryable conflict instead of a duplicate.
async function nextRefNumber(tx: Tx): Promise<string> {
  const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(approvalRequest)
  const next = (rows[0]?.n ?? 0) + 1
  return `APR-${String(next).padStart(4, '0')}`
}

export async function createApprovalRequest(
  actor: Actor,
  input: NewApprovalRequestInput,
  attachments: NewAttachmentInput[],
  ctx: SoxRequestContext,
) {
  if (attachments.length > MAX_ATTACHMENTS_PER_REQUEST) {
    throw Object.assign(new Error(`Max ${MAX_ATTACHMENTS_PER_REQUEST} attachments`), { statusCode: 400 })
  }
  for (const a of attachments) {
    if (a.bytes.length > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(new Error(`Attachment ${a.filename} exceeds 4 MB`), { statusCode: 400 })
    }
  }

  const requestType: RequestType = input.requestType ?? 'payment'
  if (requestType === 'funding') {
    if (!input.network || !(FUNDING_NETWORKS as readonly string[]).includes(input.network)) {
      throw Object.assign(new Error('Funding requests need a network (ethereum, solana, tron)'), { statusCode: 400 })
    }
    if (!input.token || !(FUNDING_TOKENS as readonly string[]).includes(input.token)) {
      throw Object.assign(new Error('Funding requests need a token (USDC, USDT, ORCA, SOL, ETH)'), { statusCode: 400 })
    }
    if (!input.walletAddress?.trim()) {
      throw Object.assign(new Error('Funding requests need a wallet address'), { statusCode: 400 })
    }
    if (!input.description?.trim()) {
      throw Object.assign(new Error('Funding requests need a description'), { statusCode: 400 })
    }
  }

  // Approver snapshot: every non-banned admin except the submitter, frozen
  // at submission time so a role change mid-flight can't alter how many
  // approvals this request needs (SOX determinism). Queried OUTSIDE the
  // transaction — it's a read.
  const admins = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(and(eq(user.role, 'admin'), eq(user.banned, false), ne(user.id, actor.id)))

  return await db.transaction(async (tx) => {
    const refNumber = await nextRefNumber(tx)
    const [created] = await tx.insert(approvalRequest).values({
      refNumber,
      submitterId: actor.id,
      requestType,
      network: requestType === 'funding' ? input.network : null,
      token: requestType === 'funding' ? input.token : null,
      walletAddress: requestType === 'funding' ? input.walletAddress!.trim() : null,
      vendorName: input.vendorName,
      description: input.description ?? null,
      amount: input.amount.toFixed(2),
      currency: input.currency || 'USD',
      invoiceNumber: input.invoiceNumber ?? null,
      invoiceDate: input.invoiceDate ?? null,
      dueDate: input.dueDate ?? null,
      glAccount: input.glAccount ?? null,
      department: input.department ?? null,
      entity: input.entity ?? null,
      paymentType: input.paymentType ?? null,
    }).returning()

    const attachmentMeta: { filename: string; sha256: string; sizeBytes: number }[] = []
    for (const a of attachments) {
      const digest = sha256Hex(a.bytes)
      await tx.insert(approvalAttachment).values({
        requestId: created.id,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.bytes.length,
        sha256: digest,
        data: a.bytes,
        uploadedById: actor.id,
      })
      attachmentMeta.push({ filename: a.filename, sha256: digest, sizeBytes: a.bytes.length })
    }

    if (admins.length > 0) {
      await tx.insert(approvalAssignee).values(
        admins.map((a) => ({ requestId: created.id, userId: a.id, email: a.email })),
      )
    }

    // Transactional audit row — commits or rolls back with the request.
    await tx.insert(auditLog).values({
      userId: actor.id === 'dev-user' ? null : actor.id,
      action: 'approval.submitted',
      resourceType: 'approval_request',
      resourceId: created.id,
      metadata: {
        refNumber,
        byEmail: actor.email,
        requestType,
        vendorName: input.vendorName,
        amount: input.amount,
        currency: input.currency || 'USD',
        ...(requestType === 'funding' ? {
          network: input.network,
          token: input.token,
          walletAddress: input.walletAddress?.trim(),
        } : {}),
        assignedApprovers: admins.map((a) => a.email),
        attachments: attachmentMeta,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    })

    return created
  })
}

/** Record that an eligible approver opened the request detail. Debounced to
 * one 'approval.viewed' row per (user, request) per 10 minutes so repeated
 * fetches don't spam the trail. Returns silently for non-approvers. */
export async function recordApprovalView(
  actor: Actor,
  requestId: string,
  ctx: SoxRequestContext,
): Promise<void> {
  const DEBOUNCE_MS = 10 * 60 * 1000
  const cutoff = new Date(Date.now() - DEBOUNCE_MS)
  const recent = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(
      eq(auditLog.action, 'approval.viewed'),
      eq(auditLog.userId, actor.id),
      eq(auditLog.resourceId, requestId),
      gte(auditLog.createdAt, cutoff),
    ))
    .limit(1)
  if (recent.length > 0) return

  await db.insert(auditLog).values({
    userId: actor.id === 'dev-user' ? null : actor.id,
    action: 'approval.viewed',
    resourceType: 'approval_request',
    resourceId: requestId,
    metadata: { byEmail: actor.email, ip: ctx.ip, userAgent: ctx.userAgent },
  })
}

/** Approve or reject. SOX core:
 *  - submitter can never decide their own request (endpoint check + DB CHECK)
 *  - server-side review duration = decidedAt − latest 'approval.viewed' row
 *    for this (user, request); client-reported ms stored as corroboration
 *  - audit row is transactional with the status flip
 *
 * Multi-approver: when the request has assignee rows (snapshotted at
 * submission), each assignee casts one vote in approval_decision (composite
 * PK blocks re-votes). The request flips to 'approved' only when EVERY
 * assignee approved; any single rejection (note mandatory) flips it to
 * 'rejected' immediately. decided_by/decided_at/decision_note stay the
 * FINAL word — the last approver or the rejector. Requests created before
 * the snapshot existed have no assignees and keep the V1 single-decision
 * behavior.
 */
export async function decideApprovalRequest(
  actor: Actor,
  requestId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
  clientReviewMs: number | null,
  ctx: SoxRequestContext,
) {
  if (decision === 'rejected' && !note?.trim()) {
    throw Object.assign(new Error('A comment is required when rejecting a request'), { statusCode: 400 })
  }
  // Latest viewed event BEFORE the transaction so the delta excludes our
  // own writes. Absence is recorded honestly as serverReviewMs=null (the
  // approver decided without opening the detail — an auditor red flag the
  // data should surface, not hide).
  const viewedRows = await db
    .select({ createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(and(
      eq(auditLog.action, 'approval.viewed'),
      eq(auditLog.userId, actor.id),
      eq(auditLog.resourceId, requestId),
    ))
    .orderBy(desc(auditLog.createdAt))
    .limit(1)
  const lastViewedAt = viewedRows[0]?.createdAt ?? null

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .for('update')
    if (!existing) throw Object.assign(new Error('Request not found'), { statusCode: 404 })
    if (existing.status !== 'pending') {
      throw Object.assign(new Error(`Request is ${existing.status}, not pending`), { statusCode: 409 })
    }
    if (existing.submitterId === actor.id) {
      throw Object.assign(
        new Error('Separation of duties: you cannot approve or reject your own request'),
        { statusCode: 403 },
      )
    }

    const now = new Date()
    const serverReviewMs = lastViewedAt ? now.getTime() - lastViewedAt.getTime() : null

    // Assignee snapshot + votes so far (read under the FOR UPDATE lock, so
    // two concurrent last-votes can't both see "one missing").
    const assignees = await tx
      .select({ userId: approvalAssignee.userId, email: approvalAssignee.email })
      .from(approvalAssignee)
      .where(eq(approvalAssignee.requestId, requestId))
    const votes = await tx
      .select({ approverId: approvalDecision.approverId, decision: approvalDecision.decision })
      .from(approvalDecision)
      .where(eq(approvalDecision.requestId, requestId))

    let statusAfter: 'pending' | 'approved' | 'rejected'
    let pendingApprovers: string[] = []

    if (assignees.length > 0) {
      if (!assignees.some((a) => a.userId === actor.id)) {
        throw Object.assign(new Error('You are not an assigned approver for this request'), { statusCode: 403 })
      }
      if (votes.some((v) => v.approverId === actor.id)) {
        throw Object.assign(new Error('You already decided on this request'), { statusCode: 409 })
      }

      await tx.insert(approvalDecision).values({
        requestId,
        approverId: actor.id,
        decision,
        note: note?.trim() || null,
        decidedAt: now,
      })

      const approvedIds = new Set(
        votes.filter((v) => v.decision === 'approved').map((v) => v.approverId),
      )
      if (decision === 'approved') approvedIds.add(actor.id)

      statusAfter = decision === 'rejected'
        ? 'rejected'
        : assignees.every((a) => approvedIds.has(a.userId)) ? 'approved' : 'pending'
      pendingApprovers = assignees
        .filter((a) => !approvedIds.has(a.userId))
        .map((a) => a.email)
    } else {
      // Legacy V1 request (no assignee snapshot): single decision closes it.
      statusAfter = decision
    }

    const [updated] = await tx
      .update(approvalRequest)
      .set(statusAfter === 'pending'
        ? { updatedAt: now }
        : {
            status: statusAfter,
            decidedById: actor.id,
            decidedAt: now,
            decisionNote: note,
            updatedAt: now,
          })
      .where(eq(approvalRequest.id, requestId))
      .returning()

    await tx.insert(auditLog).values({
      userId: actor.id === 'dev-user' ? null : actor.id,
      action: decision === 'approved' ? 'approval.approved' : 'approval.rejected',
      resourceType: 'approval_request',
      resourceId: requestId,
      metadata: {
        refNumber: existing.refNumber,
        byEmail: actor.email,
        note,
        requestStatusAfter: statusAfter,
        ...(assignees.length > 0 ? { pendingApprovers, totalApprovers: assignees.length } : {}),
        serverReviewMs,
        clientReviewMs,
        reviewMismatch: serverReviewMs !== null && clientReviewMs !== null
          ? Math.abs(serverReviewMs - clientReviewMs) > 60_000
          : null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    })

    return updated
  })
}

/** Mark an approved request as paid, with an external payment reference
 * (tx hash / wire confirmation / Mercury reference). */
export async function markApprovalPaid(
  actor: Actor,
  requestId: string,
  paymentReference: string,
  ctx: SoxRequestContext,
) {
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .for('update')
    if (!existing) throw Object.assign(new Error('Request not found'), { statusCode: 404 })
    if (existing.status !== 'approved') {
      throw Object.assign(new Error(`Request is ${existing.status}; only approved requests can be marked paid`), { statusCode: 409 })
    }

    const now = new Date()
    const [updated] = await tx
      .update(approvalRequest)
      .set({ status: 'paid', paidById: actor.id, paidAt: now, paymentReference, updatedAt: now })
      .where(eq(approvalRequest.id, requestId))
      .returning()

    await tx.insert(auditLog).values({
      userId: actor.id === 'dev-user' ? null : actor.id,
      action: 'approval.paid',
      resourceType: 'approval_request',
      resourceId: requestId,
      metadata: {
        refNumber: existing.refNumber,
        byEmail: actor.email,
        paymentReference,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    })

    return updated
  })
}

/** Submitter cancels their own still-pending request. */
export async function cancelApprovalRequest(
  actor: Actor,
  requestId: string,
  ctx: SoxRequestContext,
) {
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .for('update')
    if (!existing) throw Object.assign(new Error('Request not found'), { statusCode: 404 })
    if (existing.submitterId !== actor.id) {
      throw Object.assign(new Error('Only the submitter can cancel a request'), { statusCode: 403 })
    }
    if (existing.status !== 'pending') {
      throw Object.assign(new Error(`Request is ${existing.status}, not pending`), { statusCode: 409 })
    }

    const now = new Date()
    const [updated] = await tx
      .update(approvalRequest)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(approvalRequest.id, requestId))
      .returning()

    await tx.insert(auditLog).values({
      userId: actor.id === 'dev-user' ? null : actor.id,
      action: 'approval.cancelled',
      resourceType: 'approval_request',
      resourceId: requestId,
      metadata: { refNumber: existing.refNumber, byEmail: actor.email, ip: ctx.ip, userAgent: ctx.userAgent },
    })

    return updated
  })
}
