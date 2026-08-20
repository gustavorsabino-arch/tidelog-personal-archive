import { and, asc, desc, eq, exists, gte, lte, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import { transaction, transactionGain, txQbState, wallet, counterpartyGlMap, qbPost, walletTokenAccountCode } from '@/lib/db/schema'
import { STABLE_TOKENS } from '@/lib/constants'
import { toDbEntity, toDisplayEntity } from '@/lib/entity'
import { defaultDescription } from '@/lib/qb-state'
import { resolveWalletGl } from '@/lib/qb/resolve-wallet-gl'
import { loadPostingHistory, historyKey, type PostingHistoryEntry } from '@/lib/qb/posting-history'
import type { Transaction, TransactionsResponse } from '@/lib/types'

export type QbStatusFilter =
  | 'unposted' | 'posted' | 'posted_modified' | 'posted_manually' | 'voided' | 'failed'

type GetTreasuryTransactionsParams = {
  entity: string
  from?: string | null
  to?: string | null
  asset?: string | null
  direction?: string | null
  wallet?: string | null
  // Server-side filter on the row's QB posting status. 'unposted' matches rows
  // with no post (or an 'unposted' qb_post), consistent with the UI.
  qbStatus?: QbStatusFilter | null
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
  postedGlAccount: string | null
  postedGlSource: 'override' | 'token' | 'default' | null
  vendorOverride: string | null
  classOverride: string | null
  postedVendor: string | null
  postedClass: string | null
}

type PerTokenGlJoinRow = {
  // D10 marker — walletAddress is notNull on the table (part of PK).
  _present: string
  perTokenAccountCode: string | null
}

type CounterpartyGlJoinRow = {
  glAccountNumber: string | null
}

type QbPostJoinRow = {
  // Presence marker — qbPost.id is notNull on the qb_post table. Without it,
  // the nested projection collapses to null when only nullable columns (e.g.
  // qbJournalEntryId, postingError) are projected. Same pattern as qbState.
  postId: string
  postingStatus: 'unposted' | 'posted' | 'posted_modified' | 'posted_manually' | 'voided' | 'failed'
  docNumber: string
  qbJournalEntryId: string | null
  duplicateWarningAt: Date | null
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
  perTokenGl: PerTokenGlJoinRow | null = null,
  counterpartyVendorName: string | null = null,
  counterpartyClassName: string | null = null,
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
  // Effective GL resolution — posted rows use the immutable snapshot written at
  // post time (postedGlAccount/postedGlSource); unposted rows resolve live from
  // the three-tier priority chain (override → per-token → wallet default).
  // isPosted uses postedGlAccount != null as the authoritative signal: we write
  // that column only on a successful post, so its presence means "was faithfully
  // posted with this GL". qbPostingStatus could be 'posted' too, but that field
  // lives on the qb_post row and is null when no post exists — less direct.
  // The same isPosted flag gates vendor/class snapshot vs. live resolution below.
  const isPosted = qbState?.postedGlAccount != null
  // Effective vendor/class: posted rows use the immutable snapshot (postedVendor/
  // postedClass written at post time); unposted rows resolve live from per-tx
  // override → counterparty wallet default → null.
  const effectiveVendor = isPosted && qbState?.postedVendor != null
    ? qbState.postedVendor
    : (qbState?.vendorOverride ?? counterpartyVendorName ?? null)
  const effectiveClass = isPosted && qbState?.postedClass != null
    ? qbState.postedClass
    : (qbState?.classOverride ?? counterpartyClassName ?? null)
  const { code: effectiveGlAccount, source: glSource } = isPosted
    ? { code: qbState!.postedGlAccount, source: qbState!.postedGlSource }
    : resolveWalletGl({
        override: qbState?.glAccountOverride,
        perToken: perTokenGl?.perTokenAccountCode,
        default: walletAccountCode,
      })

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
    qbDuplicateWarning: qbPostRow?.duplicateWarningAt != null,
    // Task 10 — effective GL per row + provenance.
    isPosted,
    effectiveGlAccount,
    glSource,
    // Task 2 (vendor/class) — counterparty wallet defaults, per-tx overrides,
    // and effective values (snapshot for posted rows, live resolution otherwise).
    counterpartyVendorName,
    counterpartyClassName,
    vendorOverride: qbState?.vendorOverride ?? null,
    classOverride: qbState?.classOverride ?? null,
    effectiveVendor,
    effectiveClass,
  }
}

export async function getTreasuryTransactions({
  entity,
  from,
  to,
  asset,
  direction,
  wallet: walletAddr,
  qbStatus,
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

  // QB posting-status filter. The posting status lives on qb_post (reached via
  // tx_qb_state.post_id), which the count/summary queries don't join — so we
  // express it as a correlated EXISTS against `transaction` (aliased so it
  // doesn't collide with the page query's own tx_qb_state/qb_post joins). This
  // keeps page + count + summary consistent under the single shared `where`.
  if (qbStatus) {
    const s = alias(txQbState, 'tx_qb_state_sf')
    const p = alias(qbPost, 'qb_post_sf')
    const corr = and(
      eq(s.txHash, transaction.txHash),
      eq(s.walletAddress, transaction.walletAddress),
      eq(s.direction, transaction.direction),
      eq(s.asset, transaction.asset),
    )
    if (qbStatus === 'unposted') {
      // Unposted = no linked qb_post with a non-'unposted' status (the UI renders
      // null and 'unposted' identically).
      conditions.push(
        notExists(
          db.select({ x: sql`1` }).from(s).innerJoin(p, eq(p.id, s.postId))
            .where(and(corr, ne(p.postingStatus, 'unposted'))),
        ),
      )
    } else {
      conditions.push(
        exists(
          db.select({ x: sql`1` }).from(s).innerJoin(p, eq(p.id, s.postId))
            .where(and(corr, eq(p.postingStatus, qbStatus))),
        ),
      )
    }
  }

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
      counterpartyVendorName: cpWallet.qbVendorName,
      counterpartyClassName: cpWallet.qbClassName,
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
        postedGlAccount: txQbState.postedGlAccount,
        postedGlSource: txQbState.postedGlSource,
        vendorOverride: txQbState.vendorOverride,
        classOverride: txQbState.classOverride,
        postedVendor: txQbState.postedVendor,
        postedClass: txQbState.postedClass,
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
        duplicateWarningAt: qbPost.duplicateWarningAt,
      },
      perTokenGl: {
        // D10 marker — walletAddress is notNull on wallet_token_account_code (part of PK).
        // accountCode is also notNull on this table, but aliasing walletAddress makes
        // the marker intent explicit and guards against future schema changes.
        _present: walletTokenAccountCode.walletAddress,
        perTokenAccountCode: walletTokenAccountCode.accountCode,
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
    // Per-(wallet, token) GL mapping. PK is (walletAddress, tokenSymbol) so
    // each transaction row joins at most one row — no fan-out.
    .leftJoin(
      walletTokenAccountCode,
      and(
        eq(walletTokenAccountCode.walletAddress, transaction.walletAddress),
        eq(walletTokenAccountCode.tokenSymbol, transaction.asset),
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

  // Smart prefill from posting history: unposted rows missing a counterparty
  // GL / vendor / class inherit the values from the most recent POSTED tx of
  // the SAME (wallet, counterparty) pair. They surface through the same
  // "default" slots the counterparty-wallet config uses, so the UI shows
  // them in italics and post-batch resolves identically
  // (lib/qb/post-batch.ts applies the same fallback). Skipped for unbounded
  // internal reads (FIFO etc.) — those callers don't render GL columns.
  let history = new Map<string, PostingHistoryEntry>()
  if (!unbounded) {
    const pairs = pageRows
      .filter((r) =>
        r.txn.counterparty
        && r.qbState?.postedGlAccount == null // posted rows keep their immutable snapshot
        && (
          !r.counterpartyVendorName
          || !r.counterpartyClassName
          // History is looked up whenever there is no per-tx override — the
          // per-WALLET history outranks the per-counterparty map below.
          || !r.qbState?.counterpartyGlOverride
        ))
      .map((r) => ({ walletAddress: r.txn.walletAddress, counterparty: r.txn.counterparty! }))
    if (pairs.length > 0) {
      history = await loadPostingHistory(pairs).catch((err) => {
        console.error('[posting-history] lookup failed:', (err as Error).message)
        return new Map<string, PostingHistoryEntry>()
      })
    }
  }

  const transactions = pageRows.map((row) => {
    const hist = row.txn.counterparty && row.qbState?.postedGlAccount == null
      ? history.get(historyKey(row.txn.walletAddress, row.txn.counterparty))
      : undefined
    // Counterparty GL default precedence: per-WALLET posting history first,
    // then the per-counterparty memorized map. The map is cross-wallet (one
    // value per counterparty for the whole entity), while finance's rule is
    // per wallet — what THIS wallet actually posted last wins. A per-tx
    // override still beats both (it's the `value`, these are the default).
    const counterpartyGl = hist?.counterpartyGl
      ? { glAccountNumber: hist.counterpartyGl }
      : row.counterpartyGl
    return rowToTransaction(
      row.txn,
      row.walletLabel ?? '',
      row.counterpartyLabel ?? null,
      row.gain ?? null,
      row.qbState ?? null,
      row.walletAccountCode ?? null,
      counterpartyGl ?? null,
      row.qbPost ?? null,
      row.perTokenGl ?? null,
      row.counterpartyVendorName ?? hist?.vendor ?? null,
      row.counterpartyClassName ?? hist?.className ?? null,
    )
  })

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
