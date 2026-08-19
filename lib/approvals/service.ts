import { createHash } from 'node:crypto'
import { and, desc, eq, gte, isNotNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { approvalRequest, approvalAttachment, approvalLink, approvalAssignee, approvalDecision, auditLog, user, userDepartment, financeApprover } from '@/lib/db/schema'
import {
  slackEnabled,
  slackPostApprovalCard,
  slackThreadEvent,
  slackUpdateApprovalCard,
  type SlackCardRequest,
} from '@/lib/slack/approvals'
import { gdriveEnabled, gdriveUpload } from '@/lib/gdrive/client'
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
export const MAX_ATTACHMENTS_PER_REQUEST = 5           // per upload batch
export const MAX_TOTAL_ATTACHMENTS = 10                // lifetime cap per request
export const MAX_LINKS_PER_REQUEST = 20

/** SOX attestation shown right above the Approve button; approving records
 * this version in the audit trail as evidence the approver saw it. */
export const APPROVAL_ATTESTATION_VERSION = 'doa-2026-08'
export const APPROVAL_ATTESTATION_TEXT =
  'The goods or services were authorized and received, the vendor and amount are reasonable and consistent with the agreement/PO, the expense has a legitimate business purpose, and the approver has authority under the Delegation of Authority policy.'

export type NewLinkInput = { url: string; label?: string | null }

/** Validates and normalizes an evidence link. Returns null when invalid. */
export function normalizeLink(raw: NewLinkInput): { url: string; label: string | null } | null {
  const trimmed = raw.url?.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return { url: trimmed, label: raw.label?.trim() || null }
  } catch {
    return null
  }
}

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
  // External document links (Google Drive contracts/invoices etc.)
  links?: NewLinkInput[]
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

/**
 * USD value used ONLY to pick the finance-approval tier. There is no FX
 * feed here, so the mapping is deliberately conservative (when in doubt,
 * MORE approvers): USD-pegged at face value; EUR/GBP padded 1.5×; MYR/AED
 * face value (their face amount already exceeds the USD value); anything
 * volatile or unknown (SOL, ETH, ORCA, …) forces the strictest tier.
 */
function usdEquivalentForTier(amount: number, currency: string): number {
  const c = currency.toUpperCase()
  if (c === 'USD' || c === 'USDC' || c === 'USDT') return amount
  if (c === 'EUR' || c === 'GBP') return amount * 1.5
  if (c === 'MYR' || c === 'AED') return amount
  return Number.POSITIVE_INFINITY
}

function shortEmail(email: string): string {
  return email.split('@')[0]
}

/** Mirror freshly saved attachments into the company Google Drive folder
 * and record each copy as an audited approval_link (visible in the UI's
 * Documents list). Best-effort: Postgres stays the source of truth; a
 * Drive outage or missing config silently skips the mirror. */
async function mirrorAttachmentsToDrive(
  requestId: string,
  refNumber: string,
  actor: Actor,
  attachments: NewAttachmentInput[],
): Promise<void> {
  try {
    if (!gdriveEnabled() || attachments.length === 0) return
    const linkRows: { requestId: string; url: string; label: string; addedById: string }[] = []
    for (const a of attachments) {
      const uploaded = await gdriveUpload(`${refNumber} - ${a.filename}`, a.contentType, a.bytes)
      if (uploaded?.webViewLink) {
        linkRows.push({
          requestId,
          url: uploaded.webViewLink,
          label: `Drive · ${a.filename}`,
          addedById: actor.id,
        })
      }
    }
    if (linkRows.length > 0) {
      await db.insert(approvalLink).values(linkRows)
      await db.insert(auditLog).values({
        userId: actor.id === 'dev-user' ? null : actor.id,
        action: 'approval.drive_mirrored',
        resourceType: 'approval_request',
        resourceId: requestId,
        metadata: {
          refNumber,
          byEmail: actor.email,
          files: linkRows.map((l) => l.label),
          links: linkRows.map((l) => l.url),
        },
      })
    }
  } catch (err) {
    console.error('[gdrive] mirror failed:', (err as Error).message)
  }
}

/** Mirror a status change to the request's Slack card (thread line +
 * in-place card update). Best-effort by design: Slack must never fail or
 * slow a SOX action, so every error is swallowed after logging. */
async function notifySlackStatus(
  row: typeof approvalRequest.$inferSelect,
  opts: { thread?: string; approversLine?: string | null },
): Promise<void> {
  try {
    if (!slackEnabled() || !row.slackMessageTs) return
    const [sub] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, row.submitterId))
      .limit(1)
    const card: SlackCardRequest = {
      refNumber: row.refNumber,
      status: row.status,
      requestType: row.requestType,
      vendorName: row.vendorName,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      department: row.department,
      entity: row.entity,
      network: row.network,
      token: row.token,
      walletAddress: row.walletAddress,
      submitterEmail: sub?.email ?? 'unknown',
    }
    if (opts.thread) await slackThreadEvent(row.slackMessageTs, opts.thread)
    await slackUpdateApprovalCard(row.slackMessageTs, card, opts.approversLine ?? null)
  } catch (err) {
    console.error('[slack] notify failed:', (err as Error).message)
  }
}

// APR-<zero-padded sequence>. The advisory xact-lock serializes concurrent
// submissions so two transactions can't both read count=N and collide on
// the UNIQUE ref_number (the lock releases automatically at commit/abort).
async function nextRefNumber(tx: Tx): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('approval_ref_number'))`)
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

  const links = (input.links ?? [])
    .map(normalizeLink)
    .filter((l): l is { url: string; label: string | null } => l !== null)
  if (links.length > MAX_LINKS_PER_REQUEST) {
    throw Object.assign(new Error(`Max ${MAX_LINKS_PER_REQUEST} links`), { statusCode: 400 })
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

  const currency = input.currency || 'USD'

  // ── Approval matrix (Delegation of Authority) ──
  // Read LIVE from access control at every submission so role changes are
  // always reflected, then SNAPSHOT onto the request so an in-flight
  // request's requirement never changes (SOX determinism).
  // Finance pool = every non-banned admin PLUS anyone marked as a Finance
  // approver in Access Control (finance_approver table — e.g. HR with
  // company-wide cost visibility, who isn't an admin). Department heads =
  // non-banned budget_viewers with the request's department marked in
  // user_department, EXCLUDING finance-pool members — being finance always
  // wins over being a head.
  const financePool = await db
    .selectDistinct({ id: user.id, email: user.email })
    .from(user)
    .leftJoin(financeApprover, eq(financeApprover.userId, user.id))
    .where(and(
      eq(user.banned, false),
      or(eq(user.role, 'admin'), isNotNull(financeApprover.userId)),
    ))
  const financeIds = new Set(financePool.map((u) => u.id))
  const submitterIsFinance = financeIds.has(actor.id)
  const financeAssignees = financePool.filter((u) => u.id !== actor.id)
  if (financeAssignees.length === 0) {
    throw Object.assign(
      new Error('No eligible finance approvers exist — another admin or finance approver is required in Access Control'),
      { statusCode: 409 },
    )
  }

  let headAssignees: { id: string; email: string }[] = []
  if (requestType === 'payment' && input.department) {
    const heads = await db
      .select({ id: user.id, email: user.email })
      .from(userDepartment)
      .innerJoin(user, eq(userDepartment.userId, user.id))
      .where(and(
        // Case-insensitive on purpose — a casing variant must never skip
        // the mandatory head sign-off (the API also normalizes upstream).
        sql`lower(${userDepartment.department}) = lower(${input.department})`,
        eq(user.role, 'budget_viewer'),
        eq(user.banned, false),
      ))
    const eligibleHeads = heads.filter((h) => !financeIds.has(h.id))
    // A head submitting for their own department IS the head sign-off —
    // the stage only exists when someone else must vouch for the spend.
    const submitterIsHead = eligibleHeads.some((h) => h.id === actor.id)
    if (!submitterIsHead) headAssignees = eligibleHeads
  }
  const requiredHeadApprovals = headAssignees.length > 0 ? 1 : 0

  // Finance involvement by USD tier — ≤$10k → 2 finance people, ≤$25k → 3,
  // >$25k → everyone. A finance submitter counts toward the involvement
  // number, so the APPROVALS needed are involvement − 1 in that case.
  const usdForTier = usdEquivalentForTier(input.amount, currency)
  const involvement = usdForTier <= 10_000
    ? Math.min(2, financePool.length)
    : usdForTier <= 25_000
      ? Math.min(3, financePool.length)
      : financePool.length
  const requiredFinanceApprovals = Math.max(
    1,
    Math.min(involvement - (submitterIsFinance ? 1 : 0), financeAssignees.length),
  )

  const created = await db.transaction(async (tx) => {
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
      currency,
      requiredHeadApprovals,
      requiredFinanceApprovals,
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

    await tx.insert(approvalAssignee).values([
      ...headAssignees.map((a) => ({ requestId: created.id, userId: a.id, email: a.email, stage: 'head' as const })),
      ...financeAssignees.map((a) => ({ requestId: created.id, userId: a.id, email: a.email, stage: 'finance' as const })),
    ])

    if (links.length > 0) {
      await tx.insert(approvalLink).values(
        links.map((l) => ({ requestId: created.id, url: l.url, label: l.label, addedById: actor.id })),
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
        approvalMatrix: {
          headApprovers: headAssignees.map((a) => a.email),
          requiredHeadApprovals,
          financeApprovers: financeAssignees.map((a) => a.email),
          requiredFinanceApprovals,
          submitterIsFinance,
          usdTierValue: Number.isFinite(usdForTier) ? usdForTier : 'volatile-asset:max-tier',
        },
        attachments: attachmentMeta,
        links: links.map((l) => l.url),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    })

    return created
  })

  // ── Slack mirror (after commit — never blocks or fails the submission) ──
  try {
    if (slackEnabled()) {
      const parts: string[] = []
      if (headAssignees.length > 0) {
        parts.push(`Head: ${headAssignees.map((a) => shortEmail(a.email)).join(' or ')} (1 needed)`)
      }
      parts.push(`Finance: ${financeAssignees.map((a) => shortEmail(a.email)).join(', ')} (${requiredFinanceApprovals} needed)`)
      const ts = await slackPostApprovalCard(
        {
          refNumber: created.refNumber,
          status: created.status,
          requestType: created.requestType,
          vendorName: created.vendorName,
          description: created.description,
          amount: created.amount,
          currency: created.currency,
          department: created.department,
          entity: created.entity,
          network: created.network,
          token: created.token,
          walletAddress: created.walletAddress,
          submitterEmail: actor.email,
        },
        parts.join(' → '),
      )
      if (ts) {
        await db.update(approvalRequest)
          .set({ slackMessageTs: ts })
          .where(eq(approvalRequest.id, created.id))
        created.slackMessageTs = ts
      }
    }
  } catch (err) {
    console.error('[slack] create notify failed:', (err as Error).message)
  }

  await mirrorAttachmentsToDrive(created.id, created.refNumber, actor, attachments)

  return created
}

/** Add attachments and/or links to an EXISTING request — files can be
 * forgotten at submission or arrive later (receipts after payment).
 * Allowed for the submitter and admins while the request is pending,
 * approved, or paid (never on rejected/cancelled — those are closed).
 * Everything is audit-logged; nothing is ever removed or replaced. */
export async function addApprovalEvidence(
  actor: Actor,
  requestId: string,
  attachments: NewAttachmentInput[],
  linksInput: NewLinkInput[],
  ctx: SoxRequestContext,
  actorIsAdmin: boolean,
) {
  if (attachments.length > MAX_ATTACHMENTS_PER_REQUEST) {
    throw Object.assign(new Error(`Max ${MAX_ATTACHMENTS_PER_REQUEST} attachments per upload`), { statusCode: 400 })
  }
  for (const a of attachments) {
    if (a.bytes.length > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(new Error(`Attachment ${a.filename} exceeds 4 MB`), { statusCode: 400 })
    }
  }
  const links = linksInput
    .map(normalizeLink)
    .filter((l): l is { url: string; label: string | null } => l !== null)
  if (attachments.length === 0 && links.length === 0) {
    throw Object.assign(new Error('Nothing to add — provide files or a valid https link'), { statusCode: 400 })
  }

  const updatedRow = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .for('update')
    if (!existing) throw Object.assign(new Error('Request not found'), { statusCode: 404 })
    if (existing.submitterId !== actor.id && !actorIsAdmin) {
      throw Object.assign(new Error('Only the submitter or an admin can add documents'), { statusCode: 403 })
    }
    if (existing.status === 'rejected' || existing.status === 'cancelled') {
      throw Object.assign(new Error(`Request is ${existing.status} — documents can no longer be added`), { statusCode: 409 })
    }

    if (attachments.length > 0) {
      const [{ n: existingCount }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(approvalAttachment)
        .where(eq(approvalAttachment.requestId, requestId))
      if (existingCount + attachments.length > MAX_TOTAL_ATTACHMENTS) {
        throw Object.assign(new Error(`Max ${MAX_TOTAL_ATTACHMENTS} attachments per request (has ${existingCount})`), { statusCode: 400 })
      }
    }
    if (links.length > 0) {
      const [{ n: existingLinks }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(approvalLink)
        .where(eq(approvalLink.requestId, requestId))
      if (existingLinks + links.length > MAX_LINKS_PER_REQUEST) {
        throw Object.assign(new Error(`Max ${MAX_LINKS_PER_REQUEST} links per request`), { statusCode: 400 })
      }
    }

    const attachmentMeta: { filename: string; sha256: string; sizeBytes: number }[] = []
    for (const a of attachments) {
      const digest = sha256Hex(a.bytes)
      await tx.insert(approvalAttachment).values({
        requestId,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.bytes.length,
        sha256: digest,
        data: a.bytes,
        uploadedById: actor.id,
      })
      attachmentMeta.push({ filename: a.filename, sha256: digest, sizeBytes: a.bytes.length })
    }
    if (links.length > 0) {
      await tx.insert(approvalLink).values(
        links.map((l) => ({ requestId, url: l.url, label: l.label, addedById: actor.id })),
      )
    }

    await tx.insert(auditLog).values({
      userId: actor.id === 'dev-user' ? null : actor.id,
      action: 'approval.evidence_added',
      resourceType: 'approval_request',
      resourceId: requestId,
      metadata: {
        refNumber: existing.refNumber,
        byEmail: actor.email,
        attachments: attachmentMeta,
        links: links.map((l) => l.url),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    })

    return existing
  })

  // Thread-only Slack note (no card re-render — status didn't change and a
  // re-render would drop the "Waiting on" line on pending requests).
  const bits: string[] = []
  if (attachments.length > 0) bits.push(`${attachments.length} file${attachments.length === 1 ? '' : 's'}`)
  if (links.length > 0) bits.push(`${links.length} link${links.length === 1 ? '' : 's'}`)
  await slackThreadEvent(updatedRow.slackMessageTs, `📎 ${shortEmail(actor.email)} added ${bits.join(' + ')}`)
    .catch(() => {})

  await mirrorAttachmentsToDrive(requestId, updatedRow.refNumber, actor, attachments)

  return { attachmentsAdded: attachments.length, linksAdded: links.length }
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
 * Approval matrix: assignees are snapshotted at submission in two stages.
 * The 'head' stage (department head, 1 approval suffices) must be satisfied
 * before any 'finance' vote counts is accepted; the 'finance' stage needs
 * `required_finance_approvals` votes (amount-tiered). Any rejection (note
 * mandatory) at any stage rejects immediately. The composite PK on
 * approval_decision blocks re-votes. decided_by/decided_at/decision_note
 * stay the FINAL word — the closing approver or the rejector.
 *
 * Back-compat: requests with assignees but NULL required_finance_approvals
 * (created before the matrix) need every assignee to approve; requests with
 * no assignees at all (V1) accept a single decision from any admin
 * (actorCanApproveAll).
 */
export async function decideApprovalRequest(
  actor: Actor,
  requestId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
  clientReviewMs: number | null,
  ctx: SoxRequestContext,
  actorCanApproveAll: boolean,
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

  const outcome = await db.transaction(async (tx) => {
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
      .select({ userId: approvalAssignee.userId, email: approvalAssignee.email, stage: approvalAssignee.stage })
      .from(approvalAssignee)
      .where(eq(approvalAssignee.requestId, requestId))
    const votes = await tx
      .select({ approverId: approvalDecision.approverId, decision: approvalDecision.decision })
      .from(approvalDecision)
      .where(eq(approvalDecision.requestId, requestId))

    let statusAfter: 'pending' | 'approved' | 'rejected'
    let pendingApprovers: string[] = []

    if (assignees.length > 0) {
      const me = assignees.find((a) => a.userId === actor.id)
      if (!me) {
        throw Object.assign(new Error('You are not an assigned approver for this request'), { statusCode: 403 })
      }
      if (votes.some((v) => v.approverId === actor.id)) {
        throw Object.assign(new Error('You already decided on this request'), { statusCode: 409 })
      }

      const requiredFinance = existing.requiredFinanceApprovals
      const requiredHead = existing.requiredHeadApprovals ?? 0
      const headIds = new Set(assignees.filter((a) => a.stage === 'head').map((a) => a.userId))
      const approvedIds = new Set(votes.filter((v) => v.decision === 'approved').map((v) => v.approverId))
      const headApprovedSoFar = [...approvedIds].filter((id) => headIds.has(id)).length
      const headSatisfiedBefore = requiredHead === 0 || headApprovedSoFar >= requiredHead

      // Stage gating applies to APPROVALS only — heads sign off first,
      // finance approves after. A REJECTION is never gated: any assignee
      // can kill a bad request at any moment (SOX veto), which the
      // decision === 'rejected' branch below honors immediately.
      if (requiredFinance !== null && decision === 'approved') {
        if (me.stage === 'finance' && !headSatisfiedBefore) {
          throw Object.assign(
            new Error('Waiting for the department head approval before finance can approve'),
            { statusCode: 409 },
          )
        }
        if (me.stage === 'head' && headSatisfiedBefore) {
          throw Object.assign(
            new Error('The department-head stage is already satisfied for this request'),
            { statusCode: 409 },
          )
        }
      }

      await tx.insert(approvalDecision).values({
        requestId,
        approverId: actor.id,
        decision,
        note: note?.trim() || null,
        decidedAt: now,
      })
      if (decision === 'approved') approvedIds.add(actor.id)

      if (decision === 'rejected') {
        statusAfter = 'rejected'
      } else if (requiredFinance !== null) {
        // Matrix semantics: 1 head (when required) + N finance approvals.
        const headApproved = [...approvedIds].filter((id) => headIds.has(id)).length
        const financeApproved = [...approvedIds].filter((id) => !headIds.has(id)).length
        const headOk = requiredHead === 0 || headApproved >= requiredHead
        statusAfter = headOk && financeApproved >= requiredFinance ? 'approved' : 'pending'
        if (statusAfter === 'pending') {
          pendingApprovers = assignees
            .filter((a) => !approvedIds.has(a.userId))
            .filter((a) => (a.stage === 'head' ? !headOk : true))
            .map((a) => a.email)
        }
      } else {
        // Pre-matrix multi-approver rows: every assignee must approve.
        statusAfter = assignees.every((a) => approvedIds.has(a.userId)) ? 'approved' : 'pending'
        pendingApprovers = assignees
          .filter((a) => !approvedIds.has(a.userId))
          .map((a) => a.email)
      }
    } else {
      // Legacy V1 request (no assignee snapshot): a single decision from
      // any full approver (admin) closes it.
      if (!actorCanApproveAll) {
        throw Object.assign(new Error('You are not an assigned approver for this request'), { statusCode: 403 })
      }
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
        // The DoA attestation shown above the Approve button — recording
        // its version is the SOX evidence the approver saw it.
        ...(decision === 'approved' ? { attestationVersion: APPROVAL_ATTESTATION_VERSION } : {}),
        requestStatusAfter: statusAfter,
        ...(assignees.length > 0 ? {
          pendingApprovers,
          totalApprovers: assignees.length,
          requiredHeadApprovals: existing.requiredHeadApprovals,
          requiredFinanceApprovals: existing.requiredFinanceApprovals,
        } : {}),
        serverReviewMs,
        clientReviewMs,
        reviewMismatch: serverReviewMs !== null && clientReviewMs !== null
          ? Math.abs(serverReviewMs - clientReviewMs) > 60_000
          : null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    })

    return { updated, statusAfter, pendingApprovers }
  })

  // ── Slack mirror ──
  const verb = decision === 'approved' ? '✅ approved' : '❌ rejected'
  let line = `${shortEmail(actor.email)} ${verb}`
  if (note?.trim()) line += ` — “${note.trim()}”`
  if (outcome.statusAfter === 'pending' && outcome.pendingApprovers.length > 0) {
    line += ` · still waiting on: ${outcome.pendingApprovers.map(shortEmail).join(', ')}`
  }
  await notifySlackStatus(outcome.updated, {
    thread: line,
    approversLine: outcome.statusAfter === 'pending' && outcome.pendingApprovers.length > 0
      ? `Waiting on: ${outcome.pendingApprovers.map(shortEmail).join(', ')}`
      : null,
  })

  return outcome.updated
}

/** True when the user sits in the finance approval pool RIGHT NOW (admin
 * role, or marked as Finance approver in Access Control). Used for
 * eligibility outside the per-request snapshot, e.g. Mark as Paid. */
export async function isFinancePoolMember(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .leftJoin(financeApprover, eq(financeApprover.userId, user.id))
    .where(and(
      eq(user.id, userId),
      eq(user.banned, false),
      or(eq(user.role, 'admin'), isNotNull(financeApprover.userId)),
    ))
    .limit(1)
  return !!row
}

/** Mark an approved request as paid, with an external payment reference
 * (tx hash / wire confirmation / Mercury reference). */
export async function markApprovalPaid(
  actor: Actor,
  requestId: string,
  paymentReference: string,
  ctx: SoxRequestContext,
) {
  const updatedRow = await db.transaction(async (tx) => {
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

  await notifySlackStatus(updatedRow, {
    thread: `💸 Marked paid by ${shortEmail(actor.email)} — ref: ${paymentReference}`,
  })

  return updatedRow
}

/** Cancel a still-pending request. The submitter withdraws their own; an
 * approvals:admin may also cancel someone else's (the liveness escape when
 * a snapshotted approver leaves the company and the request can otherwise
 * never complete) — recorded under a distinct audit action. */
export async function cancelApprovalRequest(
  actor: Actor,
  requestId: string,
  ctx: SoxRequestContext,
  actorIsAdmin: boolean,
) {
  const updatedRow = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .for('update')
    if (!existing) throw Object.assign(new Error('Request not found'), { statusCode: 404 })
    const isSubmitter = existing.submitterId === actor.id
    if (!isSubmitter && !actorIsAdmin) {
      throw Object.assign(new Error('Only the submitter or an admin can cancel a request'), { statusCode: 403 })
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
      action: isSubmitter ? 'approval.cancelled' : 'approval.cancelled_by_admin',
      resourceType: 'approval_request',
      resourceId: requestId,
      metadata: { refNumber: existing.refNumber, byEmail: actor.email, ip: ctx.ip, userAgent: ctx.userAgent },
    })

    return updated
  })

  await notifySlackStatus(updatedRow, {
    thread: `⚪ Cancelled by ${shortEmail(actor.email)}`,
  })

  return updatedRow
}
