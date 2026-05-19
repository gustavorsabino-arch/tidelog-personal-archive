import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import { transaction, transactionGain, wallet } from '@/lib/db/schema'
import { STABLE_TOKENS } from '@/lib/constants'
import { toDbEntity, toDisplayEntity } from '@/lib/entity'
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

export function rowToTransaction(
  row: TransactionRow,
  walletLabel: string,
  counterpartyLabel: string | null = null,
  gain: GainJoinRow | null = null,
): Transaction {
  const qty = Number(row.qty)
  const isStable = STABLE_TOKENS.has(row.asset)
  const dbPrice = row.price === null ? null : Number(row.price)
  const dbUsd = row.usd === null ? null : Number(row.usd)
  const price = isStable && dbPrice == null ? 1 : dbPrice
  const usd = isStable && dbUsd == null ? Math.abs(qty) : dbUsd
  const priceSource = isStable && row.priceSource == null ? 'stable' : row.priceSource
  return {
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
      counterpartyLabel: cpWallet.label,
      gain: {
        stGain: transactionGain.stGain,
        ltGain: transactionGain.ltGain,
        realizedTerm: transactionGain.realizedTerm,
        internal: transactionGain.internal,
        internalPairedWalletAddr: transactionGain.internalPairedWalletAddr,
        noBasis: transactionGain.noBasis,
        lots: transactionGain.lots,
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
    rowToTransaction(row.txn, row.walletLabel ?? '', row.counterpartyLabel ?? null, row.gain ?? null),
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
