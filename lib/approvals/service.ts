import { createHash } from 'node:crypto'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { approvalRequest, approvalAttachment, auditLog } from '@/lib/db/schema'
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

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024   // 4 MB per file (Vercel body budget)
export const MAX_ATTACHMENTS_PER_REQUEST = 5

export type NewApprovalRequestInput = {
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

  return await db.transaction(async (tx) => {
    const refNumber = await nextRefNumber(tx)
    const [created] = await tx.insert(approvalRequest).values({
      refNumber,
      submitterId: actor.id,
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

    // Transactional audit row — commits or rolls back with the request.
    await tx.insert(auditLog).values({
      userId: actor.id === 'dev-user' ? null : actor.id,
      action: 'approval.submitted',
      resourceType: 'approval_request',
      resourceId: created.id,
      metadata: {
        refNumber,
        byEmail: actor.email,
        vendorName: input.vendorName,
        amount: input.amount,
        currency: input.currency || 'USD',
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
 */
export async function decideApprovalRequest(
  actor: Actor,
  requestId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
  clientReviewMs: number | null,
  ctx: SoxRequestContext,
) {
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

    const [updated] = await tx
      .update(approvalRequest)
      .set({
        status: decision,
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
