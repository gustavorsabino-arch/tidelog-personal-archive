import { pgSchema, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { user } from './auth'

const app = pgSchema('app')

export const userDepartment = app.table(
  'user_department',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    department: text('department').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.department] }),
  ],
)

/**
 * Users who belong to the FINANCE approval pool without holding the admin
 * role (e.g. HR with company-wide cost visibility). The approvals matrix
 * treats finance = admins ∪ this table; anyone here is never treated as a
 * department head, even with departments marked above. Managed from the
 * Access Control page.
 */
export const financeApprover = app.table('finance_approver', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
})
