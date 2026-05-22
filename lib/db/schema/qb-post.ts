import { pgSchema, text, timestamp, uuid, index } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { entity } from './reference'

const app = pgSchema('app')

// Posting lifecycle for a qb_post row.
//   unposted        — qb_post row pre-allocated but never sent (failure pre-send)
//   posted          — successfully posted to QB; qb_journal_entry_id populated
//   posted_modified — posted, then a member tx had a material edit (GL change);
//                     needs re-post (see D3 two-tier dirty marker)
//   voided          — posted, then voided in QB; qb_journal_entry_id is kept so
//                     "View in QB" still resolves to the voided entry as audit
//                     proof of cancellation (see D14)
//   failed          — posting to QB returned an error; posting_error populated
export const qbPostingStatus = app.enum('qb_posting_status', [
  'unposted',
  'posted',
  'posted_modified',
  'voided',
  'failed',
])

// Unified posting-event store: one row per QB journal entry, regardless of
// whether the JE represents a single tx (individual post) or many txs grouped
// by (wallet, token, month) for bulk-treasury wallets. Members link via
// tx_qb_state.post_id; cardinality of that FK distinguishes the kinds.
//
// Denormalized helpers (wallet_address, token, month_yyyymm) are null for
// individual posts and populated for bulk posts; they exist for cheap WHERE
// clauses on this table without joining back through tx_qb_state.
export const qbPost = app.table(
  'qb_post',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // onDelete: 'no action' — refuse to delete an entity that still has
    // posting history. Matches the audit/financial table convention; protects
    // accounting history from accidental cascading deletes.
    entityId: text('entity_id').notNull().references(() => entity.id, { onDelete: 'no action' }),
    docNumber: text('doc_number').notNull(),
    // null until QB returns the JE id; populated on success and kept on void
    // (so "View in QB" still resolves to the voided entry — see D14)
    qbJournalEntryId: text('qb_journal_entry_id'),
    postingStatus: qbPostingStatus('posting_status').notNull().default('unposted'),
    postingError: text('posting_error'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedBy: text('posted_by').references(() => user.id, { onDelete: 'no action' }),
    // Denormalized helpers for fast filtering / display — derivable from
    // members but explicit here for cheap WHERE clauses on this table itself.
    // All three are null for individual (per-tx) posts.
    walletAddress: text('wallet_address'),
    token: text('token'),
    monthYyyymm: text('month_yyyymm'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('qb_post_entity_idx').on(t.entityId),
    index('qb_post_journal_entry_idx').on(t.qbJournalEntryId),
    index('qb_post_status_idx').on(t.postingStatus),
    // For drill-down panel: "show me all bulk JEs for entity X in month YYYY-MM"
    index('qb_post_entity_month_idx').on(t.entityId, t.monthYyyymm),
  ],
)
