import { pgSchema, text, uuid, timestamp, numeric, integer, index } from 'drizzle-orm/pg-core'

const app = pgSchema('app')

/**
 * Prepayment register — one row per prepaid expense sitting in a prepaid
 * asset account (Opco 14000 initially). The amortization schedule is
 * derived: straight-line totalAmount / months starting at startMonth, with
 * the rounding remainder on the last month. Reconciliation against the
 * actual QB general ledger happens at read time (live GL fetch) — QB stays
 * the source of truth; this table only holds the intent/terms.
 */
export const prepayment = app.table(
  'prepayment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: text('entity_id').notNull(),          // 'opco' | 'foundation' | ...
    prepaidAccount: text('prepaid_account').notNull(), // '14000'
    vendorName: text('vendor_name').notNull(),
    description: text('description'),
    totalAmount: numeric('total_amount', { precision: 20, scale: 2 }).notNull(),
    startMonth: text('start_month').notNull(),      // 'YYYY-MM' — first amortization month
    months: integer('months').notNull(),            // straight-line term
    // Where the monthly amortization JE goes: DR expense (account+class),
    // CR the prepaid account.
    expenseGlAccount: text('expense_gl_account'),
    className: text('class_name'),
    // Link back to the QB addition row (the positive entry) when imported.
    sourceTxnId: text('source_txn_id'),
    sourceDate: text('source_date'),                // 'YYYY-MM-DD'
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by'),
  },
  (t) => [index('prepayment_entity_idx').on(t.entityId, t.status)],
)
