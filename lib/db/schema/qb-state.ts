import { pgSchema, text, timestamp, uuid, primaryKey, index } from 'drizzle-orm/pg-core'
import { entity } from './reference'
import { user } from './auth'
import { qbPost } from './qb-post'

const app = pgSchema('app')

// Mutable per-tx accounting workspace for QB integration. Keyed identically
// to transaction_gain — (tx_hash, wallet_address, direction, asset) —
// because the same row identity scheme is used across all derived/mutable
// sibling tables of `transaction`. Rows are created lazily on first user
// edit (PATCH); the LEFT JOIN at read time degrades to "no row → null
// fields → render default" gracefully.
//
// No FK cascade to `transaction`: deleting a transaction is a destructive
// admin op that should explicitly decide whether QB state survives. Leaving
// the FK would silently drop posting history. If the tx is gone we want to
// preserve the audit trail in audit_log + the orphan row here is benign.
//
// Columns added incrementally:
//   Wave 2a (this task) — description
//   Wave 2b — glAccountOverride, counterpartyGlOverride
//   Wave 2c — qbPostingStatus, qbJournalEntryId, qbPostedAt, qbPostingError
export const txQbState = app.table(
  'tx_qb_state',
  {
    txHash: text('tx_hash').notNull(),
    walletAddress: text('wallet_address').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    asset: text('asset').notNull(),
    entityId: text('entity_id').notNull().references(() => entity.id),
    // Wave 2a — user-saved override; null = use computed default at read time
    description: text('description'),
    // Wave 2b — per-tx GL overrides
    glAccountOverride: text('gl_account_override'),
    counterpartyGlOverride: text('counterparty_gl_override'),
    // Wave 2c — link to the qb_post row this tx is a member of. Null = unposted.
    // onDelete: 'set null' — if a posting is hard-deleted (rare, admin-only),
    // keep this row alive but mark it unposted. tx_qb_state isn't accounting
    // truth on its own (it's editable state); the qb_post row itself is the
    // accounting record protected by 'no action' on its FKs.
    postId: uuid('post_id').references(() => qbPost.id, { onDelete: 'set null' }),
    // Audit
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by').references(() => user.id),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.walletAddress, t.direction, t.asset] }),
    index('tx_qb_state_entity_idx').on(t.entityId),
    // Drill-down ("show me all member txs of bulk JE X") is WHERE post_id = X
    index('tx_qb_state_post_id_idx').on(t.postId),
  ],
)
