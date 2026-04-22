import { pgSchema, text, uuid, jsonb, timestamp, date, index, unique, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { entity } from './reference'

const app = pgSchema('app')

export const qbConnection = app.table('qb_connection', {
  // entityId is PK so sandbox testing can point every entity at the same
  // realm without collisions. In production each entity has its own company
  // anyway, so uniqueness on realmId is over-constraining.
  entityId: text('entity_id').primaryKey().references(() => entity.id),
  realmId: text('realm_id').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  realmName: text('realm_name'),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const qbReportCache = app.table(
  'qb_report_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: text('entity_id').notNull().references(() => entity.id),
    reportType: text('report_type', {
      enum: ['balance_sheet', 'profit_and_loss', 'general_ledger'],
    }).notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    filterParams: jsonb('filter_params').notNull().default({}),
    data: jsonb('data').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('qb_report_cache_unique').on(
      t.entityId, t.reportType, t.periodStart, t.periodEnd, t.filterParams,
    ),
    index('qb_report_cache_lookup_idx').on(t.entityId, t.reportType, t.fetchedAt),
  ],
)

export const qbAccountMap = app.table(
  'qb_account_map',
  {
    // realmId is an external Intuit identifier, not an FK — multiple
    // qb_connection rows can now share a realm, and the account map is
    // per-realm metadata orthogonal to which entity authenticated.
    realmId: text('realm_id').notNull(),
    qbAccountId: text('qb_account_id').notNull(),
    qbAccountNumber: text('qb_account_number'),
    qbAccountName: text('qb_account_name').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.realmId, t.qbAccountId] }),
  ],
)

/**
 * Per-entity account catalog refreshed by the cron. Used by the budget drill
 * to translate an account number into QB's internal account ID when building
 * GL queries against qb_report_cache.
 */
export const qbAccountCatalog = app.table(
  'qb_account_catalog',
  {
    entityId: text('entity_id').notNull().references(() => entity.id),
    qbAccountId: text('qb_account_id').notNull(),
    qbAccountNumber: text('qb_account_number'),
    qbAccountName: text('qb_account_name').notNull(),
    accountType: text('account_type'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.qbAccountId] }),
    index('qb_account_catalog_number_idx').on(t.entityId, t.qbAccountNumber),
  ],
)

/**
 * Per-transaction payloads written by the cron so the drill never has to
 * hit QuickBooks live. Keyed by (entity_id, txn_id); payloads are
 * effectively immutable once posted.
 */
export const qbTransactionCache = app.table(
  'qb_transaction_cache',
  {
    entityId: text('entity_id').notNull().references(() => entity.id),
    txnId: text('txn_id').notNull(),
    resourceType: text('resource_type').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.txnId] }),
  ],
)

/**
 * Tracks admin-initiated QuickBooks force-refresh runs. One row per dispatch.
 *
 * The partial unique index on status='running' is the concurrency lock:
 * only one force refresh can be in flight at any time. A second INSERT
 * conflicts with 23505, which the route handler translates to HTTP 409.
 *
 * Rows are not updated by the dispatching request (which returns 202 and
 * exits); they're transitioned to 'succeeded' or 'failed' by the background
 * job that runs via after(). If the background function is killed before
 * completing the transition, the route handler has a stale-lock rule that
 * reclaims the row after a timeout.
 */
export const qbForceRefreshRun = app.table(
  'qb_force_refresh_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    fromPeriod: text('from_period').notNull(),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'canceled'] }).notNull(),
    requestedByEmail: text('requested_by_email').notNull(),
    error: text('error'),
    result: jsonb('result'),
  },
  (t) => [
    uniqueIndex('qb_force_refresh_run_one_running_idx')
      .on(t.status)
      .where(sql`${t.status} = 'running'`),
    index('qb_force_refresh_run_started_idx').on(t.startedAt.desc()),
  ],
)
