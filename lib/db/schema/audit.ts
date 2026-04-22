import { pgSchema, text, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { user } from './auth'

const app = pgSchema('app')

export const auditLog = app.table(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),  // nullable for system actions
    action: text('action').notNull(),        // e.g. 'role.assigned', 'cron.fetch-prices.succeeded'
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_user_time_idx').on(t.userId, t.createdAt),
    index('audit_action_time_idx').on(t.action, t.createdAt),
  ],
)
