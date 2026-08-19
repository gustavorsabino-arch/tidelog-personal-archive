import { pgSchema, text, uuid, timestamp, numeric, integer, date, index, check, customType, primaryKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { user } from './auth'

const app = pgSchema('app')

// Postgres bytea — drizzle has no built-in type for it. Buffer in, Buffer out.
const bytea = customType<{ data: Buffer; notNull: true }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * Payment approval request — the Bill.com-style workflow unit.
 *
 * SOX design notes:
 *  - decided_by_id <> submitter_id is enforced by a DB CHECK (separation of
 *    duties survives even a buggy endpoint).
 *  - Rows are never deleted; terminal states are 'rejected' / 'cancelled' /
 *    'paid'. History of every state change lives in audit_log (append-only,
 *    trigger-guarded) with ip/user-agent/review-time metadata.
 *  - Attachments carry a SHA-256 of the original bytes, written at upload
 *    time and logged to audit_log — tamper evidence for the stored file.
 */
export const approvalRequest = app.table(
  'approval_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Human-readable reference (APR-0001…). Populated from a sequence via
    // the insert path; unique for lookups from Slack/email conversations.
    refNumber: text('ref_number').notNull().unique(),

    submitterId: text('submitter_id').notNull().references(() => user.id),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected', 'paid', 'cancelled'],
    }).notNull().default('pending'),

    // 'payment' = invoice/vendor payment (full accounting fields);
    // 'funding' = internal wallet top-up (network/token/walletAddress),
    // the flow that used to live in Slack.
    requestType: text('request_type', {
      enum: ['payment', 'funding'],
    }).notNull().default('payment'),

    // Funding-only fields (null on payments).
    network: text('network', { enum: ['ethereum', 'solana', 'tron'] }),
    token: text('token'),
    walletAddress: text('wallet_address'),

    // What is being paid.
    vendorName: text('vendor_name').notNull(),
    description: text('description'),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    invoiceNumber: text('invoice_number'),
    invoiceDate: date('invoice_date'),
    dueDate: date('due_date'),
    // Accounting coding — free-text account number + class/department +
    // entity so the payer can post to QB without guessing.
    glAccount: text('gl_account'),
    department: text('department'),
    entity: text('entity'),
    paymentType: text('payment_type', {
      enum: ['wire', 'ach', 'crypto', 'card', 'check', 'other'],
    }),

    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),

    // Approval-matrix snapshot, frozen at submission (Delegation of
    // Authority): how many 'head'-stage approvals are needed (0 or 1) and
    // how many 'finance'-stage approvals (amount-tiered: ≤$10k → 2 finance
    // people involved incl. a finance submitter, ≤$25k → 3, >$25k → all).
    // NULL on requests created before the matrix existed — those keep the
    // older all-assignees-must-approve behavior.
    requiredHeadApprovals: integer('required_head_approvals'),
    requiredFinanceApprovals: integer('required_finance_approvals'),

    // Decision (single approver in V1 — multi-approver goes in a separate
    // table when dual-approval ships; these columns stay as the FINAL word).
    decidedById: text('decided_by_id').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),

    // Paid step (post-approval bookkeeping).
    paidById: text('paid_by_id').references(() => user.id),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentReference: text('payment_reference'),

    // Slack status card: ts of the message posted to the approvals channel
    // at submission — later status changes chat.update this same message.
    slackMessageTs: text('slack_message_ts'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('approval_submitter_idx').on(t.submitterId, t.submittedAt),
    index('approval_status_idx').on(t.status, t.submittedAt),
    // SOX separation of duties at the storage layer: whoever decides can
    // never be the submitter, no matter what the application layer does.
    check('chk_decider_not_submitter', sql`${t.decidedById} IS NULL OR ${t.decidedById} <> ${t.submitterId}`),
  ],
)

/**
 * Invoice/receipt files attached to a request. Bytes live in Postgres
 * (bytea) — zero new infra, and the attachment insert commits in the same
 * transaction as the request row. SHA-256 recorded for tamper evidence.
 * Size capped at the API layer (4 MB/file — Vercel request budget).
 */
export const approvalAttachment = app.table(
  'approval_attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().references(() => approvalRequest.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    data: bytea('data').notNull(),
    uploadedById: text('uploaded_by_id').notNull().references(() => user.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('approval_attachment_request_idx').on(t.requestId)],
)

/**
 * External document links attached to a request (Google Drive contracts,
 * invoices already stored elsewhere). The file stays where it lives with
 * its own access control; tidelog stores the audited pointer. Addable at
 * submission and afterwards (audit-logged either way).
 */
export const approvalLink = app.table(
  'approval_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().references(() => approvalRequest.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    label: text('label'),
    addedById: text('added_by_id').notNull().references(() => user.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('approval_link_request_idx').on(t.requestId)],
)

/**
 * Who must approve a request — snapshotted at submission time (every admin
 * except the submitter). Snapshotting keeps the requirement deterministic
 * for SOX: hiring a new admin mid-flight doesn't retroactively change how
 * many approvals an in-flight request needs. Email denormalized so the
 * trail stays readable even if the user row is later renamed.
 */
export const approvalAssignee = app.table(
  'approval_assignee',
  {
    requestId: uuid('request_id').notNull().references(() => approvalRequest.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id),
    email: text('email').notNull(),
    // 'head' = department head sign-off (goes first, 1 of them suffices);
    // 'finance' = finance/admin approval (amount-tiered quorum, votes only
    // after the head stage is satisfied).
    stage: text('stage', { enum: ['head', 'finance'] }).notNull().default('finance'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.userId] }),
  ],
)

/**
 * Per-approver decisions. A request is 'approved' only when EVERY assignee
 * has an 'approved' row; any single 'rejected' row (note required) flips
 * the request to rejected. One decision per (request, approver) — the PK
 * makes double-voting impossible at the storage layer.
 */
export const approvalDecision = app.table(
  'approval_decision',
  {
    requestId: uuid('request_id').notNull().references(() => approvalRequest.id, { onDelete: 'cascade' }),
    approverId: text('approver_id').notNull().references(() => user.id),
    decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
    note: text('note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.approverId] }),
  ],
)
