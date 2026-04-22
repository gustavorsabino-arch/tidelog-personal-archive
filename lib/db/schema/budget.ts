import { pgSchema, text, uuid, boolean, numeric, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { entity } from './reference'

const app = pgSchema('app')

export const budgetTeamMember = app.table('budget_team_member', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email'),
  entityId: text('entity_id').references(() => entity.id),
  classification: text('classification'),
  department: text('department').notNull(),
  role: text('role'),
  location: text('location'),
  ft: boolean('ft').notNull().default(true),
  salary: numeric('salary', { precision: 20, scale: 2 }),
  bonus: numeric('bonus', { precision: 20, scale: 2 }),
  status: text('status', { enum: ['active', 'inactive', 'pending'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const budgetLine = app.table(
  'budget_line',
  {
    year: integer('year').notNull(),
    department: text('department').notNull(),
    // 'annual' or month key '01'..'12'. Imported xlsx workbooks typically
    // provide both: annual = sum of monthly, monthly = per-month allocation.
    period: text('period').notNull().default('annual'),
    lineItem: text('line_item').notNull(),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    notes: text('notes'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.year, t.department, t.period, t.lineItem] }),
  ],
)

export const budgetQbMapping = app.table(
  'budget_qb_mapping',
  {
    qbAccountNumber: text('qb_account_number').notNull(),
    department: text('department').notNull(),
    lineItem: text('line_item').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.qbAccountNumber, t.department, t.lineItem] }),
  ],
)
