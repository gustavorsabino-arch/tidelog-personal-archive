import { pgSchema, text, primaryKey } from 'drizzle-orm/pg-core'
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
