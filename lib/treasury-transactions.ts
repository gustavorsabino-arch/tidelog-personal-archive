import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { price as priceTable, transaction, wallet } from '@/lib/db/schema'
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
  hydratePrices?: boolean
}

type TransactionRow = typeof transaction.$inferSelect
type WalletRow = typeof wallet.$inferSelect

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function rowToTransaction(row: TransactionRow, walletLabel: string): Transaction {
  const qty = Number(row.qty)
  const price = row.price === null ? null : Number(row.price)
  const usd = row.usd === null ? null : Number(row.usd)
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
    priceSource: row.priceSource,
    counterparty: row.counterparty,
    category: row.category,
  }
}

const ONE_HOUR_SEC = 60 * 60

/**
 * Hydrate display-time USD/price on each transaction using cached prices only.
 *
 * Performance: one bulk query to `price` for all tokens that still need
 * hydration, then an in-memory binary search per row. Replaces the prior
 * one-query-per-transaction approach that took several seconds for thousands
 * of rows.
 *
 * Architecture: request path is cache-only — no DeFiLlama fallback. External
 * price fetches are the `fetch-prices` cron's job; if a row is still unpriced
 * here it stays unpriced until the cron backfills.
 */
async function hydratePricesFromDb(transactions: Transaction[]): Promise<Transaction[]> {
  if (transactions.length === 0) return transactions

  // Fast-path: figure out which rows actually need lookups.
  const needs = transactions.filter((tx) =>
    !STABLE_TOKENS.has(tx.asset) && (tx.price == null || tx.usd == null),
  )
  if (needs.length === 0) {
    return transactions.map((tx) => STABLE_TOKENS.has(tx.asset)
      ? {
          ...tx,
          price: tx.price ?? 1,
          usd: tx.usd ?? Math.abs(tx.qty),
          priceSource: tx.priceSource ?? 'stable',
        }
      : tx,
    )
  }

  const tokens = Array.from(new Set(needs.map((tx) => tx.asset)))
  const rows = await db
    .select({ token: priceTable.token, timestamp: priceTable.timestamp, price: priceTable.price })
    .from(priceTable)
    .where(inArray(priceTable.token, tokens))
    .orderBy(asc(priceTable.timestamp))

  // Group timestamps per token; each array stays sorted ascending from the ORDER BY.
  const pricesByToken = new Map<string, Array<{ ts: number; price: number }>>()
  for (const row of rows) {
    const arr = pricesByToken.get(row.token) ?? []
    arr.push({ ts: Math.floor(row.timestamp.getTime() / 1000), price: Number(row.price) })
    pricesByToken.set(row.token, arr)
  }

  // Binary-search for the nearest cached price within ±1h of the transaction time.
  function findPriceAt(token: string, blockTime: number): number | null {
    const arr = pricesByToken.get(token)
    if (!arr || arr.length === 0) return null
    let lo = 0
    let hi = arr.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (arr[mid].ts <= blockTime) lo = mid
      else hi = mid - 1
    }
    const floor = arr[lo]
    const ceil = lo + 1 < arr.length ? arr[lo + 1] : null
    const best = !ceil || Math.abs(floor.ts - blockTime) <= Math.abs(ceil.ts - blockTime) ? floor : ceil
    return Math.abs(best.ts - blockTime) <= ONE_HOUR_SEC ? best.price : null
  }

  return transactions.map((tx) => {
    if (STABLE_TOKENS.has(tx.asset)) {
      return {
        ...tx,
        price: tx.price ?? 1,
        usd: tx.usd ?? Math.abs(tx.qty),
        priceSource: tx.priceSource ?? 'stable',
      }
    }
    if (tx.price != null && tx.usd != null) return tx
    const p = findPriceAt(tx.asset, tx.blockTime)
    return {
      ...tx,
      price: p ?? tx.price,
      usd: p != null ? Math.abs(tx.qty) * p : tx.usd,
      priceSource: tx.priceSource ?? (p != null ? 'db-historical' : null),
    }
  })
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
  hydratePrices = true,
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
  const pageQueryBase = db
    .select()
    .from(transaction)
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

  const walletAddresses = Array.from(new Set(pageRows.map((row) => row.walletAddress)))
  const walletRows: WalletRow[] = walletAddresses.length
    ? await db.select().from(wallet).where(inArray(wallet.address, walletAddresses))
    : []
  const walletLabels = new Map(walletRows.map((row) => [row.address, row.label]))

  let transactions = pageRows.map((row) => rowToTransaction(row, walletLabels.get(row.walletAddress) ?? ''))
  if (hydratePrices) {
    transactions = await hydratePricesFromDb(transactions)
  }

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

export async function getTreasuryTransactionsAsc(
  entity: string,
): Promise<Transaction[]> {
  const rows = await db
    .select()
    .from(transaction)
    .where(eq(transaction.entityId, toDbEntity(entity)))
    .orderBy(asc(transaction.blockTime))
  const walletAddresses = Array.from(new Set(rows.map((row) => row.walletAddress)))
  const walletRows = walletAddresses.length
    ? await db.select().from(wallet).where(inArray(wallet.address, walletAddresses))
    : []
  const walletLabels = new Map(walletRows.map((row) => [row.address, row.label]))
  return rows.map((row) => rowToTransaction(row, walletLabels.get(row.walletAddress) ?? ''))
}
