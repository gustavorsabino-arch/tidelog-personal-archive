import { pgSchema, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { entity } from './reference'
import { user } from './auth'

const app = pgSchema('app')

// Memorized "for this counterparty in this entity, use this GL account."
// Populated whenever a user picks a GL via the Counterparty GL dropdown on
// the transactions page. One row per (entity, counterparty_address).
//
// The resolution chain at posting time (Wave 2c):
//   tx_qb_state.counterparty_gl_override → counterparty_gl_map → null
//
// No FK to wallet — counterparty addresses may be unknown wallets (external
// or not yet ingested). The address is just a string identifier here.
export const counterpartyGlMap = app.table(
  'counterparty_gl_map',
  {
    entityId: text('entity_id').notNull().references(() => entity.id),
    counterpartyAddress: text('counterparty_address').notNull(),
    glAccountNumber: text('gl_account_number').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by').references(() => user.id),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.counterpartyAddress] }),
  ],
)
