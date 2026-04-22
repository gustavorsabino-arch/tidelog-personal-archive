import { pgSchema, text, uuid, timestamp, numeric, date, index, unique, primaryKey } from 'drizzle-orm/pg-core'
import { entity, wallet, token } from './reference'

const app = pgSchema('app')

export const transaction = app.table(
  'transaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    txHash: text('tx_hash').notNull(),
    walletAddress: text('wallet_address').notNull().references(() => wallet.address),
    entityId: text('entity_id').notNull().references(() => entity.id),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
    asset: text('asset').notNull().references(() => token.symbol),
    qty: numeric('qty', { precision: 38, scale: 18 }).notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    price: numeric('price', { precision: 38, scale: 18 }),
    usd: numeric('usd', { precision: 20, scale: 2 }),
    priceSource: text('price_source'),
    counterparty: text('counterparty'),
    category: text('category'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('tx_unique').on(t.txHash, t.walletAddress, t.asset, t.direction),
    index('tx_entity_time_idx').on(t.entityId, t.blockTime),
    index('tx_wallet_time_idx').on(t.walletAddress, t.blockTime),
  ],
)

export const balanceSnapshot = app.table(
  'balance_snapshot',
  {
    date: date('date').notNull(),
    walletAddress: text('wallet_address').notNull().references(() => wallet.address),
    token: text('token').notNull().references(() => token.symbol),
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.walletAddress, t.token] }),
    index('balance_date_idx').on(t.date),
  ],
)

export const price = app.table(
  'price',
  {
    token: text('token').notNull().references(() => token.symbol),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    price: numeric('price', { precision: 38, scale: 18 }).notNull(),
    source: text('source', { enum: ['latest', 'historical'] }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.token, t.timestamp] }),
    index('price_token_ts_idx').on(t.token, t.timestamp),
  ],
)
