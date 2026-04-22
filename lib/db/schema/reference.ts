import { pgSchema, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core'

const app = pgSchema('app')

export const entity = app.table('entity', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  qbRealmId: text('qb_realm_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const wallet = app.table('wallet', {
  address: text('address').primaryKey(),
  label: text('label').notNull(),
  chain: text('chain').notNull(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  accountCode: text('account_code'),
  isExternal: boolean('is_external').notNull().default(false),
  overviewOnly: boolean('overview_only').notNull().default(false),
  includeInOverview: boolean('include_in_overview').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const token = app.table('token', {
  symbol: text('symbol').primaryKey(),
  name: text('name').notNull(),
  decimals: integer('decimals').notNull(),
  coinId: text('coin_id'),                  // DefiLlama identifier, nullable for stablecoins
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
