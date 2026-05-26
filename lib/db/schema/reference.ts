import { pgSchema, text, boolean, integer, timestamp, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const app = pgSchema('app')

export const entity = app.table('entity', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  qbRealmId: text('qb_realm_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const walletType = app.enum('wallet_type', ['internal', 'external'])

export const wallet = app.table('wallet', {
  address: text('address').primaryKey(),
  label: text('label').notNull(),
  chain: text('chain').notNull(),
  entityId: text('entity_id').notNull().references(() => entity.id),
  accountCode: text('account_code'),
  type: walletType('type').notNull().default('internal'),
  hiddenFromFinance: boolean('hidden_from_finance').notNull().default(false),
  needsBackfill: boolean('needs_backfill').notNull().default(false),
  lastFullBackfillAt: timestamp('last_full_backfill_at', { withTimezone: true }),
  isBulkTreasury: boolean('is_bulk_treasury').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('chk_external_not_hidden', sql`NOT (${t.type} = 'external' AND ${t.hiddenFromFinance} = true)`),
])

export const token = app.table('token', {
  symbol: text('symbol').primaryKey(),
  name: text('name').notNull(),
  decimals: integer('decimals').notNull(),
  coinId: text('coin_id'),                  // DefiLlama identifier, nullable for stablecoins
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
