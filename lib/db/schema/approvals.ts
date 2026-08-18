import { pgSchema, text, uuid, timestamp, numeric, integer, date, index, check, customType } from 'drizzle-orm/pg-core'
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

    // Decision (single approver in V1 — multi-approver goes in a separate
    // table when dual-approval ships; these columns stay as the FINAL word).
    decidedById: text('decided_by_id').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),

    // Paid step (post-approval bookkeeping).
    paidById: text('paid_by_id').references(() => user.id),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentReference: text('payment_reference'),

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
