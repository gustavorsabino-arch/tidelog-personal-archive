import { pgSchema, text, timestamp, numeric, integer, boolean, jsonb, index, primaryKey } from 'drizzle-orm/pg-core'
import { entity } from './reference'

const app = pgSchema('app')

// Materialized FIFO output, one row per (tx, wallet, direction, asset).
// Asset is in the PK because a single tx can produce moves for multiple assets
// on the same wallet+direction (e.g., a swap: SOL out + ORCA out from the same
// wallet within one tx_hash). Mirrors the unique key on app.transaction
// (tx_hash, wallet_address, asset, direction).
export const transactionGain = app.table(
  'transaction_gain',
  {
    txHash: text('tx_hash').notNull(),
    walletAddress: text('wallet_address').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    entityId: text('entity_id').notNull().references(() => entity.id),
    asset: text('asset').notNull(),
    stGain: numeric('st_gain', { precision: 20, scale: 2 }).notNull().default('0'),
    ltGain: numeric('lt_gain', { precision: 20, scale: 2 }).notNull().default('0'),
    realizedTerm: text('realized_term', { enum: ['ST', 'LT', 'mixed'] }),
    internal: boolean('internal').notNull().default(false),
    internalPairedWalletAddr: text('internal_paired_wallet_addr'),
    noBasis: boolean('no_basis').notNull().default(false),
    lots: jsonb('lots').notNull().default('[]'),
    balanceAfter: numeric('balance_after', { precision: 38, scale: 18 }).notNull().default('0'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.walletAddress, t.direction, t.asset] }),
    index('tx_gain_entity_idx').on(t.entityId, t.asset),
  ],
)

export const fifoState = app.table(
  'fifo_state',
  {
    entityId: text('entity_id').notNull().references(() => entity.id),
    asset: text('asset').notNull(),
    openLots: jsonb('open_lots').notNull().default('[]'),
    lastProcessedBlocktime: timestamp('last_processed_blocktime', { withTimezone: true }),
    txCountAtLastCompute: integer('tx_count_at_last_compute').notNull().default(0),
    fifoVersion: integer('fifo_version').notNull().default(1),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.asset] }),
  ],
)
