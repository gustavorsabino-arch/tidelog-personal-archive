import { pgSchema, text, uuid, boolean, numeric, integer, timestamp, primaryKey, date } from 'drizzle-orm/pg-core'
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

export const budgetTeamEmploymentDates = app.table('budget_team_employment_dates', {
  memberId: uuid('member_id').primaryKey(),
  startDate: date('start_date'),
  terminationDate: date('termination_date'),
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

// Append-only adjustments layered on top of the imported plan. This table IS
// the durable, shared log (who/when/why, every create and reversal). The report
// overlays active adjustments onto the budget; reversed rows stay for the log.
export const budgetAdjustment = app.table('budget_adjustment', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull(),
  department: text('department').notNull(),
  lineItem: text('line_item').notNull(),
  // 'one_time' applies to startPeriod only; 'recurring' applies to
  // startPeriod..startPeriod+durationMonths-1 (clamped to Dec of `year`).
  kind: text('kind', { enum: ['one_time', 'recurring'] }).notNull(),
  // Signed: positive increases the budget, negative decreases it.
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
  startPeriod: text('start_period').notNull(), // '01'..'12'
  durationMonths: integer('duration_months').notNull().default(1),
  notes: text('notes').notNull(),
  status: text('status', { enum: ['active', 'reversed'] }).notNull().default('active'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reversedBy: text('reversed_by'),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
})

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

export const budgetQbMappingExclusion = app.table(
  'budget_qb_mapping_exclusion',
  {
    qbAccountNumber: text('qb_account_number').primaryKey(),
    reason: text('reason').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
)
