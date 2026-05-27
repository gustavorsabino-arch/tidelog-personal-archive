import { and, desc, eq, gte, lte, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transaction, wallet, transactionGain } from '@/lib/db/schema'
import { GAINS_ASSETS } from '@/lib/orca-gains-writer'
import { toDisplayEntity, toDbEntity } from '@/lib/entity'
import type { GainLossEntry, GainLossResponse, LotTraceEntry, Transaction } from '@/lib/types'

/**
 * Genesis (TGE) rows are seed cost-basis lots. The writer marks them synthetic
 * via this helper before passing to the FIFO engine. Still exported because
 * the writer in lib/orca-gains-writer.ts imports it — single source of truth.
 */
export function markSynthetic(txs: Transaction[]): Transaction[] {
  return txs.map((t) =>
    t.priceSource === 'genesis' ? ({ ...t, _synthetic: true } as Transaction) : t,
  )
}

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 500

export interface GetTreasuryGainLossOpts {
  from?: number | null
  to?: number | null
  token?: string | null
  term?: 'ST' | 'LT' | null
  walletAddr?: string | null
  page?: number
  pageSize?: number
}

/**
 * Build the WHERE conditions shared between the summary and detail queries
 * so they can't drift. `term` is intentionally NOT applied here — it's a
 * per-lot filter, applied during summary aggregation via CASE and during
 * detail-row lot expansion.
 */
function buildBaseConditions(
  dbEntity: string,
  opts: { from?: number | null; to?: number | null; token?: string | null; walletAddr?: string | null },
): SQL[] {
  const conditions: SQL[] = [
    eq(transactionGain.entityId, dbEntity),
    eq(transactionGain.direction, 'out'),
    inArray(transactionGain.asset, [...GAINS_ASSETS]),
  ]
  if (opts.from != null) conditions.push(gte(transaction.blockTime, new Date(opts.from * 1000)))
  if (opts.to != null) conditions.push(lte(transaction.blockTime, new Date(opts.to * 1000)))
  if (opts.token) conditions.push(eq(transactionGain.asset, opts.token))
  if (opts.walletAddr) conditions.push(eq(transactionGain.walletAddress, opts.walletAddr))
  return conditions
}

export async function getTreasuryGainLoss(
  entity: string,
  opts: GetTreasuryGainLossOpts = {},
): Promise<GainLossResponse> {
  const dbEntity = toDbEntity(entity)
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE))
  const offset = (page - 1) * pageSize
  const term = opts.term ?? null

  const baseConditions = buildBaseConditions(dbEntity, opts)

  // Summary aggregation — single query computes everything the KPI cards need.
  // Per-term lot counts use the `realized_term` column as a fast path:
  //   - 'ST' rows: all lots are ST, count = jsonb_array_length (cheap)
  //   - 'LT' rows: all lots are LT, count = jsonb_array_length (cheap)
  //   - 'mixed' rows: need jsonb_array_elements unnest to count per-term lots
  // Mixed rows should be rare (only disposals that span the 1-year ST/LT
  // boundary), so this avoids unnesting 95%+ of rows.
  const [summaryRow] = await db
    .select({
      stTotal: sql<string>`coalesce(sum(${transactionGain.stGain}), 0)`,
      ltTotal: sql<string>`coalesce(sum(${transactionGain.ltGain}), 0)`,
      totalLots: sql<string>`coalesce(sum(jsonb_array_length(${transactionGain.lots})), 0)`,
      stLots: sql<string>`coalesce(sum(case
        when ${transactionGain.realizedTerm} = 'ST' then jsonb_array_length(${transactionGain.lots})
        when ${transactionGain.realizedTerm} = 'LT' then 0
        else (select count(*) from jsonb_array_elements(${transactionGain.lots}) e where e->>'term' = 'ST')
      end), 0)`,
      ltLots: sql<string>`coalesce(sum(case
        when ${transactionGain.realizedTerm} = 'LT' then jsonb_array_length(${transactionGain.lots})
        when ${transactionGain.realizedTerm} = 'ST' then 0
        else (select count(*) from jsonb_array_elements(${transactionGain.lots}) e where e->>'term' = 'LT')
      end), 0)`,
      totalRows: sql<string>`count(*)`,
    })
    .from(transactionGain)
    .innerJoin(transaction, and(
      eq(transaction.txHash, transactionGain.txHash),
      eq(transaction.walletAddress, transactionGain.walletAddress),
      eq(transaction.direction, transactionGain.direction),
      eq(transaction.asset, transactionGain.asset),
    ))
    .where(and(...baseConditions))

  // Distinct tokens for the dropdown — uses the same base conditions but
  // intentionally drops the token filter so the dropdown lists every token
  // present in the wider filter set (not just the currently-selected one).
  const tokenBaseConditions = buildBaseConditions(dbEntity, { ...opts, token: null })
  const tokenRows = await db
    .selectDistinct({ asset: transactionGain.asset })
    .from(transactionGain)
    .innerJoin(transaction, and(
      eq(transaction.txHash, transactionGain.txHash),
      eq(transaction.walletAddress, transactionGain.walletAddress),
      eq(transaction.direction, transactionGain.direction),
      eq(transaction.asset, transactionGain.asset),
    ))
    .where(and(...tokenBaseConditions))
  const tokens = tokenRows.map(r => r.asset).sort()

  // Detail query — paginated by row. Newest first (matches the client's default
  // sort). Lots are expanded in code after the page is fetched, then filtered
  // by term so a page of rows produces a variable but bounded set of entries.
  const detailConditions = [...baseConditions]
  if (term === 'ST') detailConditions.push(sql`${transactionGain.stGain} != 0`)
  if (term === 'LT') detailConditions.push(sql`${transactionGain.ltGain} != 0`)

  const rows = await db
    .select({
      tg: transactionGain,
      tx: transaction,
      walletLabel: wallet.label,
    })
    .from(transactionGain)
    .innerJoin(transaction, and(
      eq(transaction.txHash, transactionGain.txHash),
      eq(transaction.walletAddress, transactionGain.walletAddress),
      eq(transaction.direction, transactionGain.direction),
      eq(transaction.asset, transactionGain.asset),
    ))
    .leftJoin(wallet, eq(wallet.address, transactionGain.walletAddress))
    .where(and(...detailConditions))
    .orderBy(desc(transaction.blockTime))
    .limit(pageSize)
    .offset(offset)

  const entries: GainLossEntry[] = []
  for (const r of rows) {
    const lots = (r.tg.lots as LotTraceEntry[]) ?? []
    if (lots.length === 0) continue
    const sellPrice = r.tx.price != null ? Number(r.tx.price) : 0
    const soldDate = r.tx.blockTime.toISOString()
    for (const l of lots) {
      if (term && l.term !== term) continue
      entries.push({
        wallet: r.walletLabel ?? r.tx.walletAddress,
        walletAddr: r.tx.walletAddress,
        entity: toDisplayEntity(r.tg.entityId),
        asset: r.tg.asset,
        qty: l.qty,
        buyPrice: l.costPerUnit,
        sellPrice,
        buyDate: l.acqDate,
        soldDate,
        gain: l.gain,
        term: l.term,
        txHash: r.tg.txHash,
      })
    }
  }

  // Compose summary from the aggregation row, then zero out the irrelevant
  // term bucket when a term filter is applied so the KPI cards mirror the
  // old client-side `filteredSummary` behavior.
  const stTotal = Number(summaryRow?.stTotal ?? 0)
  const ltTotal = Number(summaryRow?.ltTotal ?? 0)
  const totalLots = Number(summaryRow?.totalLots ?? 0)
  const stLots = Number(summaryRow?.stLots ?? 0)
  const ltLots = Number(summaryRow?.ltLots ?? 0)
  const totalRows = Number(summaryRow?.totalRows ?? 0)

  const shortTermGain = term === 'LT' ? 0 : stTotal
  const longTermGain = term === 'ST' ? 0 : ltTotal
  const dispositions = term === 'ST' ? stLots : term === 'LT' ? ltLots : totalLots

  // For pagination: total post-term-filter row count. When term filter is
  // 'ST', rows with only LT lots are excluded server-side via the `st_gain != 0`
  // predicate, so totalRows reflects only matching disposal rows.
  let paginationRows = totalRows
  if (term === 'ST' || term === 'LT') {
    const [filteredRow] = await db
      .select({ count: sql<string>`count(*)` })
      .from(transactionGain)
      .innerJoin(transaction, and(
        eq(transaction.txHash, transactionGain.txHash),
        eq(transaction.walletAddress, transactionGain.walletAddress),
        eq(transaction.direction, transactionGain.direction),
        eq(transaction.asset, transactionGain.asset),
      ))
      .where(and(...detailConditions))
    paginationRows = Number(filteredRow?.count ?? 0)
  }

  return {
    gainLoss: entries,
    summary: {
      totalGain: shortTermGain + longTermGain,
      shortTermGain,
      longTermGain,
      dispositions,
      tokens,
    },
    pagination: {
      page,
      pageSize,
      totalRows: paginationRows,
      hasMore: offset + pageSize < paginationRows,
    },
  }
}

/**
 * Returns the distinct YYYY-MM months (UTC) in which this entity had
 * disposals, newest first. Sourced from the materialized transaction_gain
 * table — same data the main G/L route reads, no live FIFO.
 */
export async function getGainLossMonths(entity: string): Promise<string[]> {
  const dbEntity = toDbEntity(entity)

  // DISTINCT pushed into Postgres so we ship at most a few dozen rows back
  // (one per month) instead of one row per disposal. At 65k+ disposals per
  // entity, the old "select all blockTimes and dedupe in Node" approach was
  // both slow on the wire and slow in V8.
  const rows = await db
    .selectDistinct({
      month: sql<string>`to_char(${transaction.blockTime} at time zone 'UTC', 'YYYY-MM')`,
    })
    .from(transactionGain)
    .innerJoin(transaction, and(
      eq(transaction.txHash, transactionGain.txHash),
      eq(transaction.walletAddress, transactionGain.walletAddress),
      eq(transaction.direction, transactionGain.direction),
      // Asset must match — a single tx can carry moves for multiple assets.
      eq(transaction.asset, transactionGain.asset),
    ))
    .where(and(
      eq(transactionGain.entityId, dbEntity),
      eq(transactionGain.direction, 'out'),
      inArray(transactionGain.asset, [...GAINS_ASSETS]),
    ))

  return rows
    .map(r => r.month)
    .filter((m): m is string => typeof m === 'string')
    .sort()
    .reverse()
}
