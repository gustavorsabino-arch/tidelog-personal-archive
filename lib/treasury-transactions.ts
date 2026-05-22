import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import { transaction, transactionGain, txQbState, wallet, counterpartyGlMap, qbPost } from '@/lib/db/schema'
import { STABLE_TOKENS } from '@/lib/constants'
import { toDbEntity, toDisplayEntity } from '@/lib/entity'
import { defaultDescription } from '@/lib/qb-state'
import type { Transaction, TransactionsResponse } from '@/lib/types'

type GetTreasuryTransactionsParams = {
  entity: string
  from?: string | null
  to?: string | null
  asset?: string | null
  direction?: string | null
  wallet?: string | null
  limit?: number | null
  offset?: number
}

type TransactionRow = typeof transaction.$inferSelect

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

type GainJoinRow = {
  stGain: string | null
  ltGain: string | null
  realizedTerm: 'ST' | 'LT' | 'mixed' | null
  internal: boolean | null
  internalPairedWalletAddr: string | null
  noBasis: boolean | null
  lots: unknown // jsonb — LotTraceEntry[] at runtime
}

type QbStateJoinRow = {
  // Presence marker — see comment on the qbState projection below.
  txHash: string
  description: string | null
  glAccountOverride: string | null
  counterpartyGlOverride: string | null
}

type CounterpartyGlJoinRow = {
  glAccountNumber: string | null
}

type QbPostJoinRow = {
  // Presence marker — qbPost.id is notNull on the qb_post table. Without it,
  // the nested projection collapses to null when only nullable columns (e.g.
  // qbJournalEntryId, postingError) are projected. Same pattern as qbState.
  postId: string
  postingStatus: 'unposted' | 'posted' | 'posted_modified' | 'voided' | 'failed'
  docNumber: string
  qbJournalEntryId: string | null
}

export function rowToTransaction(
  row: TransactionRow,
  walletLabel: string,
  counterpartyLabel: string | null = null,
  gain: GainJoinRow | null = null,
  qbState: QbStateJoinRow | null = null,
  walletAccountCode: string | null = null,
  counterpartyGl: CounterpartyGlJoinRow | null = null,
  qbPostRow: QbPostJoinRow | null = null,
): Transaction {
  const qty = Number(row.qty)
  const isStable = STABLE_TOKENS.has(row.asset)
  const dbPrice = row.price === null ? null : Number(row.price)
  const dbUsd = row.usd === null ? null : Number(row.usd)
  const price = isStable && dbPrice == null ? 1 : dbPrice
  const usd = isStable && dbUsd == null ? Math.abs(qty) : dbUsd
  const priceSource = isStable && row.priceSource == null ? 'stable' : row.priceSource
  const base: Transaction = {
    txHash: row.txHash,
    walletAddr: row.walletAddress,
    wallet: walletLabel || row.walletAddress,
    entity: toDisplayEntity(row.entityId),
    blockTime: toUnix(row.blockTime),
    date: row.blockTime.toISOString(),
    asset: row.asset,
    qty: Math.abs(qty),
    dir: row.direction === 'in' ? 'In' : 'Out',
    price,
    usd,
    priceSource,
    counterparty: row.counterparty,
    category: row.category,
    counterpartyLabel,
    stGain: gain?.stGain != null ? Number(gain.stGain) : null,
    ltGain: gain?.ltGain != null ? Number(gain.ltGain) : null,
    realizedTerm: gain?.realizedTerm ?? null,
    internal: gain?.internal ?? null,
    internalPairedWalletAddr: gain?.internalPairedWalletAddr ?? null,
    noBasis: gain?.noBasis ?? null,
    lots: (gain?.lots as Transaction['lots']) ?? null,
  }
  return {
    ...base,
    id: row.id,
    description: qbState?.description ?? null,
    descriptionDefault: defaultDescription(base),
    walletGlAccount: walletAccountCode,
    counterpartyGlAccount: counterpartyGl?.glAccountNumber ?? null,
    glAccountOverride: qbState?.glAccountOverride ?? null,
    counterpartyGlOverride: qbState?.counterpartyGlOverride ?? null,
    // Wave 2c — qb_post fields. qbPostRow is null when no qb_post row is linked
    // via tx_qb_state.post_id (the common case — most rows are unposted). Each
    // field surfaces as null in that case so the client sees an explicit value
    // rather than `undefined`. Note: the projection's `_present` marker (postId
    // duplicated as the notNull JOIN key) is NOT read here — postId itself IS
    // the FK value, so it's load-bearing and stays.
    qbPostId: qbPostRow?.postId ?? null,
    qbPostingStatus: qbPostRow?.postingStatus ?? null,
    qbDocNumber: qbPostRow?.docNumber ?? null,
    qbJournalEntryId: qbPostRow?.qbJournalEntryId ?? null,
  }
}

export async function getTreasuryTransactions({
  entity,
  from,
  to,
  asset,
  direction,
  wallet: walletAddr,
  limit = 50,
  offset = 0,
}: GetTreasuryTransactionsParams): Promise<TransactionsResponse> {
  const conditions = [eq(transaction.entityId, toDbEntity(entity))]

  const fromTs = from ? Number.parseInt(from, 10) : 0
  const toTs = to ? Number.parseInt(to, 10) : 0
  if (Number.isFinite(fromTs) && fromTs > 0) {
    conditions.push(gte(transaction.blockTime, new Date(fromTs * 1000)))
  }
  if (Number.isFinite(toTs) && toTs > 0) {
    conditions.push(lte(transaction.blockTime, new Date(toTs * 1000)))
  }
  if (asset) conditions.push(eq(transaction.asset, asset))
  if (direction === 'In' || direction === 'Out') {
    conditions.push(eq(transaction.direction, direction === 'In' ? 'in' : 'out'))
  } else if (direction === 'in' || direction === 'out') {
    conditions.push(eq(transaction.direction, direction))
  }
  if (walletAddr) conditions.push(eq(transaction.walletAddress, walletAddr))

  // Hide synthetic genesis rows from generic transaction reads. The ORCA Ledger
  // queries directly without this clause so genesis flows into FIFO and the
  // dedicated ledger UI.
  conditions.push(sql`${transaction.priceSource} IS DISTINCT FROM 'genesis'`)

  const where = and(...conditions)
  // `limit == null` means "unbounded" — FIFO-style internal callers rely on
  // getting every row. `0` or negative means "use a sensible default for UI".
  // Positive numbers are honored as-is.
  const unbounded = limit === null
  const effectiveLimit = unbounded ? 0 : (limit === undefined || limit <= 0 ? 50 : limit)

  // Three parallel queries:
  //   1. the paginated page rows (unbounded skips LIMIT/OFFSET)
  //   2. total matching count (for pagination UI)
  //   3. summary totals (computed from stored USD across the whole filter set;
  //      covers stables and anything the cron has already priced — unpriced
  //      rows contribute 0 here, same as before hydration)
  const cpWallet = alias(wallet, 'cp_wallet')

  const pageQueryBase = db
    .select({
      txn: transaction,
      walletLabel: wallet.label,
      walletAccountCode: wallet.accountCode,
      counterpartyLabel: cpWallet.label,
      gain: {
        // D10 — Drizzle nested-projection collapse marker. Without a notNull
        // column in the projection, the whole `gain` object collapses to null
        // when every projected gain field happens to be null (e.g., genesis or
        // stable-token txs where stGain/ltGain/realizedTerm/internal are all
        // null). transactionGain.txHash IS notNull (PK component), so it acts
        // as the "row matched" presence signal. The `_present` key is read
        // only as a marker — `rowToTransaction` ignores it.
        _present: transactionGain.txHash,
        stGain: transactionGain.stGain,
        ltGain: transactionGain.ltGain,
        realizedTerm: transactionGain.realizedTerm,
        internal: transactionGain.internal,
        internalPairedWalletAddr: transactionGain.internalPairedWalletAddr,
        noBasis: transactionGain.noBasis,
        lots: transactionGain.lots,
      },
      qbState: {
        // txHash is a notNull presence marker. Drizzle's nested-projection from
        // LEFT JOIN collapses the whole object to null when every projected
        // column is nullable, which would hide a row that has e.g. only
        // counterpartyGlOverride set. Including the notNull JOIN key gives
        // Drizzle the "matched" signal it needs. Apply the same pattern to any
        // new field added here in future waves.
        txHash: txQbState.txHash,
        description: txQbState.description,
        glAccountOverride: txQbState.glAccountOverride,
        counterpartyGlOverride: txQbState.counterpartyGlOverride,
      },
      counterpartyGl: {
        // D10 marker — counterpartyGlMap.entityId is notNull on the table.
        // counterparty_gl_map only has glAccountNumber as a nullable-relevant
        // projected column today, but a future column addition could trigger
        // the same collapse bug. Preemptively guard.
        _present: counterpartyGlMap.entityId,
        glAccountNumber: counterpartyGlMap.glAccountNumber,
      },
      qbPost: {
        // D10 marker — qbPost.id is the table PK (notNull). It also doubles as
        // the FK value we want to surface (qbPostId), so it's not a throwaway
        // marker like the others — it gets read in rowToTransaction as `postId`.
        postId: qbPost.id,
        postingStatus: qbPost.postingStatus,
        docNumber: qbPost.docNumber,
        qbJournalEntryId: qbPost.qbJournalEntryId,
      },
    })
    .from(transaction)
    .leftJoin(wallet, eq(wallet.address, transaction.walletAddress))
    .leftJoin(cpWallet, eq(cpWallet.address, transaction.counterparty))
    .leftJoin(
      transactionGain,
      and(
        eq(transactionGain.txHash, transaction.txHash),
        eq(transactionGain.walletAddress, transaction.walletAddress),
        eq(transactionGain.direction, transaction.direction),
        // Asset must match — a single tx can carry both SOL and ORCA moves.
        eq(transactionGain.asset, transaction.asset),
      ),
    )
    .leftJoin(
      txQbState,
      and(
        eq(txQbState.txHash, transaction.txHash),
        eq(txQbState.walletAddress, transaction.walletAddress),
        eq(txQbState.direction, transaction.direction),
        eq(txQbState.asset, transaction.asset),
      ),
    )
    .leftJoin(
      counterpartyGlMap,
      and(
        eq(counterpartyGlMap.entityId, transaction.entityId),
        eq(counterpartyGlMap.counterpartyAddress, transaction.counterparty),
      ),
    )
    // Two-hop reach to qb_post: tx_qb_state holds the post_id FK. We already
    // LEFT JOIN tx_qb_state above on the tx's PK columns, so chaining here
    // gives us posting metadata for the row (or null if no qb_post linked).
    .leftJoin(qbPost, eq(qbPost.id, txQbState.postId))
    .where(where)
    .orderBy(desc(transaction.blockTime))
  const pageQuery = unbounded
    ? pageQueryBase
    : pageQueryBase.limit(effectiveLimit).offset(offset)

  const [pageRows, countRows, summaryRows] = await Promise.all([
    pageQuery,
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(transaction)
      .where(where),
    db
      .select({
        inflows: sql<string>`coalesce(sum(${transaction.usd}) filter (where ${transaction.direction} = 'in'), 0)`,
        outflows: sql<string>`coalesce(sum(${transaction.usd}) filter (where ${transaction.direction} = 'out'), 0)`,
      })
      .from(transaction)
      .where(where),
  ])

  const transactions = pageRows.map((row) =>
    rowToTransaction(
      row.txn,
      row.walletLabel ?? '',
      row.counterpartyLabel ?? null,
      row.gain ?? null,
      row.qbState ?? null,
      row.walletAccountCode ?? null,
      row.counterpartyGl ?? null,
      row.qbPost ?? null,
    ),
  )

  const inflowsUSD = Number(summaryRows[0]?.inflows ?? 0)
  const outflowsUSD = Number(summaryRows[0]?.outflows ?? 0)

  return {
    transactions,
    total: countRows[0]?.n ?? 0,
    limit: unbounded ? transactions.length : effectiveLimit,
    offset,
    summary: {
      inflowsUSD,
      outflowsUSD,
      netUSD: inflowsUSD - outflowsUSD,
    },
  }
}

export async function getTransactionMonths({
  entity,
  asset,
}: {
  entity: string
  asset?: string | null
}): Promise<string[]> {
  const conditions = [eq(transaction.entityId, toDbEntity(entity))]
  if (asset) conditions.push(eq(transaction.asset, asset))
  conditions.push(sql`${transaction.priceSource} IS DISTINCT FROM 'genesis'`)

  const monthExpr = sql<string>`to_char(${transaction.blockTime} at time zone 'UTC', 'YYYY-MM')`
  const rows = await db
    .selectDistinct({ month: monthExpr })
    .from(transaction)
    .where(and(...conditions))
    .orderBy(desc(monthExpr))

  return rows.map((row) => row.month)
}

export async function getTreasuryTransactionsAsc(
  entity: string,
): Promise<Transaction[]> {
  const rows = await db
    .select({ txn: transaction, walletLabel: wallet.label })
    .from(transaction)
    .leftJoin(wallet, eq(wallet.address, transaction.walletAddress))
    .where(eq(transaction.entityId, toDbEntity(entity)))
    .orderBy(asc(transaction.blockTime))
  return rows.map((row) => rowToTransaction(row.txn, row.walletLabel ?? ''))
}
