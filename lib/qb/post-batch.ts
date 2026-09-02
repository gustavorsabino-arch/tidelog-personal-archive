import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import {
  qbPost,
  txQbState,
  transaction,
  transactionGain,
  wallet,
  counterpartyGlMap,
  walletTokenAccountCode,
} from '@/lib/db/schema'
import { toDbEntity } from '@/lib/entity'
import { logAudit } from '@/lib/audit'
import { fetchQboJson } from './client.ts'
import { getQboRealmId, type QboEntity } from './config.ts'
import { buildJournalEntry, gainLossGlForEntity, UnresolvedAccountError, type TxForPost, type AccountResolver, type BuildArgs } from './post-journal-entry.ts'
import { readCachedAccountCatalogByNumber, readCachedClassCatalogByName, readCachedVendorCatalogByName } from './cache-reads.ts'
import {
  formatBulkDocNumber,
  formatIndividualDocNumber,
  getNextIndividualSequence,
} from './doc-number.ts'
import type {
  QbJournalEntry,
  QbJournalEntryResponse,
  QbQueryResponse,
} from './types.ts'
import { resolveWalletGl, type GlSource } from './resolve-wallet-gl'
import { ensureApprovalsSchema, hasPostedCounterpartyGlColumn } from '@/lib/db/approvals-schema'
import { loadPostingHistory, historyKey, type PostingHistoryEntry } from './posting-history'
import { defaultDescription } from '@/lib/qb-state'
import { fmtNum } from '@/lib/format'
import { STABLE_TOKENS } from '../constants.ts'

// D13 — server-enforced hard cap. Mirror of the UI cap in
// components/transactions-page-client.tsx; rejecting a >50 request here is
// defense against client tampering / direct API calls.
// The real cost driver is QB API calls = JOURNAL ENTRIES created, not
// selected transactions: a bulk-treasury wallet groups a whole month of
// txs into ONE JE, so hundreds of bulk txs are cheap while 60 individual
// txs are 60 QB calls. Cap both dimensions accordingly (D13 evolved).
const MAX_BATCH_SIZE = 1000      // selected transactions per call
const MAX_JE_GROUPS = 50         // journal entries (QB calls) per call

export type PostBatchResult = {
  successes: Array<{
    postId: string
    docNumber: string
    qbJournalEntryId: string
    memberTxIds: string[]
    // Set when the post-POST duplicate scan saw >1 JE in QB carrying our
    // DocNumber + TxnDate. The POST itself succeeded — this flag is a
    // best-effort "you should manually void the other one" signal for the UI.
    duplicateWarning?: boolean
  }>
  failures: Array<{
    docNumber: string
    error: string
    memberTxIds: string[]
  }>
  // Submitted to QB but not yet CONFIRMED within the request. QB now takes
  // minutes to create a JE and 504s its own gateway while finishing in the
  // background, so we return fast and let reconciliation adopt the JE once QB
  // makes it visible. The qb_post row is committed (status 'posting') and its
  // member txs are already linked, so no data is lost and re-posting is safe.
  pending: Array<{
    postId: string
    docNumber: string
    memberTxIds: string[]
  }>
  skipped: Array<{ txId: string; reason: string }>
}

// ────────────────────────────────────────────────────────────────────────────
// Tx loading
// ────────────────────────────────────────────────────────────────────────────

// Internal row shape produced by the load JOIN. Carries everything we need to
// (a) verify entity ownership, (b) partition into skipped/eligible, (c) group
// bulk-treasury txs, (d) hand off to buildJournalEntry.
type LoadedTx = {
  id: string
  txHash: string
  walletAddress: string
  entityId: string
  direction: 'in' | 'out'
  asset: string
  qty: number
  usd: number
  blockTime: Date
  counterpartyAddress: string | null
  counterpartyLabel: string | null
  walletAccountCode: string | null
  walletIsBulkTreasury: boolean
  glAccountOverride: string | null
  counterpartyGlOverride: string | null
  counterpartyGlMapValue: string | null
  postId: string | null
  existingPostStatus:
    | 'unposted'
    | 'posted'
    | 'posted_modified'
    | 'posted_manually'
    | 'voided'
    | 'failed'
    | null
  gainStGain: string | null
  gainLtGain: string | null
  // Populated by loadTxs from wallet_token_account_code for (walletAddress, asset).
  perTokenAccountCode: string | null
  // Populated by buildPostPlan eligibility loop — null before that pass.
  walletGlSource: GlSource | null
  /** Resolved wallet GL code (number); set on eligible txs by buildPostPlan. Non-null for any tx that passed eligibility. */
  walletGl: string | null
  /**
   * Effective description: the user's tx_qb_state.description override, or the
   * computed default. Becomes the JE Memo + every line's Description at post
   * time. Computed identically to the transactions list (lib/qb-state) so the
   * posted value matches what the user saw/edited.
   */
  description: string
  // Raw fields from the JOIN — counterparty wallet's QB-assigned names.
  counterpartyVendorName: string | null
  counterpartyClassName: string | null
  // Per-tx overrides from tx_qb_state (null = fall through to counterparty wallet).
  vendorOverride: string | null
  classOverride: string | null
  // Effective value: override → counterparty wallet → null.
  // Resolved to QB Ids at post time via the catalog maps.
  effectiveVendor: string | null
  effectiveClass: string | null
}

async function loadTxs(txIds: string[]): Promise<LoadedTx[]> {
  // Post-time writes touch tx_qb_state columns that may not exist right
  // after a deploy (posted_counterparty_gl) — heal before loading. Covers
  // both postBatch and post-preview via buildPostPlan. Memoized.
  await ensureApprovalsSchema().catch(() => {})

  // Counterparty wallet alias — counterparty is just an address; if a known
  // wallet matches we surface its label for vendor matching.
  const cpWallet = alias(wallet, 'cp_wallet')

  const rows = await db
    .select({
      txn: transaction,
      walletAccountCode: wallet.accountCode,
      walletIsBulkTreasury: wallet.isBulkTreasury,
      counterpartyLabel: cpWallet.label,
      counterpartyVendorName: cpWallet.qbVendorName,
      counterpartyClassName: cpWallet.qbClassName,
      gain: {
        // Presence marker (notNull) so Drizzle keeps the gain projection alive
        // even when both gain numbers are null. Same lesson as Wave 2b's
        // qbState fix (D10).
        _present: transactionGain.txHash,
        stGain: transactionGain.stGain,
        ltGain: transactionGain.ltGain,
      },
      qbState: {
        _present: txQbState.txHash,
        glAccountOverride: txQbState.glAccountOverride,
        counterpartyGlOverride: txQbState.counterpartyGlOverride,
        description: txQbState.description,
        postId: txQbState.postId,
        vendorOverride: txQbState.vendorOverride,
        classOverride: txQbState.classOverride,
      },
      counterpartyGl: {
        _present: counterpartyGlMap.entityId,
        glAccountNumber: counterpartyGlMap.glAccountNumber,
      },
      existingPostStatus: qbPost.postingStatus,
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
    .leftJoin(qbPost, eq(qbPost.id, txQbState.postId))
    .where(inArray(transaction.id, txIds))

  // Build per-(wallet, token) account code map for these rows.
  const distinctWallets = [...new Set(rows.map((r) => r.txn.walletAddress))]
  const perTokenRows =
    distinctWallets.length > 0
      ? await db
          .select({
            walletAddress: walletTokenAccountCode.walletAddress,
            tokenSymbol: walletTokenAccountCode.tokenSymbol,
            accountCode: walletTokenAccountCode.accountCode,
          })
          .from(walletTokenAccountCode)
          .where(inArray(walletTokenAccountCode.walletAddress, distinctWallets))
      : []
  const perTokenMap = new Map<string, string>()
  for (const row of perTokenRows) {
    perTokenMap.set(`${row.walletAddress}::${row.tokenSymbol}`, row.accountCode)
  }

  // Smart prefill from posting history — the SAME lowest-priority fallback
  // the transactions list applies (lib/treasury-transactions.ts), so what
  // the operator saw prefilled is exactly what gets posted: counterparty
  // GL / vendor / class inherited from the most recent posted tx of the
  // same (wallet, counterparty) pair.
  const historyPairs = rows
    .filter((r) => r.txn.counterparty && (
      !r.counterpartyVendorName
      || !r.counterpartyClassName
      // No per-tx override → the per-WALLET history outranks the map.
      || !r.qbState?.counterpartyGlOverride
    ))
    .map((r) => ({ walletAddress: r.txn.walletAddress, counterparty: r.txn.counterparty!, direction: r.txn.direction }))
  const history = historyPairs.length > 0
    ? await loadPostingHistory(historyPairs).catch((err) => {
        console.error('[posting-history] lookup failed:', (err as Error).message)
        return new Map<string, PostingHistoryEntry>()
      })
    : new Map<string, PostingHistoryEntry>()

  return rows.map((r): LoadedTx => {
    const hist = r.txn.counterparty
      ? history.get(historyKey(r.txn.walletAddress, r.txn.counterparty, r.txn.direction))
      : undefined
    return {
    id: r.txn.id,
    txHash: r.txn.txHash,
    walletAddress: r.txn.walletAddress,
    entityId: r.txn.entityId,
    direction: r.txn.direction,
    asset: r.txn.asset,
    qty: Number(r.txn.qty),
    // For stable tokens with null usd, fall back to |qty| — same default as
    // rowToTransaction in lib/treasury-transactions.ts.
    usd: r.txn.usd != null ? Number(r.txn.usd) : Math.abs(Number(r.txn.qty)),
    blockTime: r.txn.blockTime,
    counterpartyAddress: r.txn.counterparty,
    counterpartyLabel: r.counterpartyLabel ?? null,
    walletAccountCode: r.walletAccountCode ?? null,
    walletIsBulkTreasury: r.walletIsBulkTreasury ?? false,
    glAccountOverride: r.qbState?.glAccountOverride ?? null,
    counterpartyGlOverride: r.qbState?.counterpartyGlOverride ?? null,
    // Per-WALLET posting history first, then the per-counterparty map (the
    // map is cross-wallet; finance's rule is per wallet). Mirrors the list
    // view exactly. A per-tx override still beats both downstream.
    counterpartyGlMapValue: hist?.counterpartyGl ?? r.counterpartyGl?.glAccountNumber ?? null,
    postId: r.qbState?.postId ?? null,
    existingPostStatus: r.existingPostStatus ?? null,
    gainStGain: r.gain?.stGain ?? null,
    gainLtGain: r.gain?.ltGain ?? null,
    perTokenAccountCode:
      perTokenMap.get(`${r.txn.walletAddress}::${r.txn.asset}`) ?? null,
    walletGlSource: null, // populated by buildPostPlan eligibility loop
    walletGl: null, // populated by buildPostPlan eligibility loop
    counterpartyVendorName: r.counterpartyVendorName ?? hist?.vendor ?? null,
    counterpartyClassName: r.counterpartyClassName ?? hist?.className ?? null,
    vendorOverride: r.qbState?.vendorOverride ?? null,
    classOverride: r.qbState?.classOverride ?? null,
    // Effective vendor/class: tx override → counterparty wallet → posting
    // history (same wallet+counterparty) → null. Resolved to QB Ids at post
    // time via catalog maps in postBatch.
    effectiveVendor: r.qbState?.vendorOverride ?? r.counterpartyVendorName ?? hist?.vendor ?? null,
    effectiveClass: r.qbState?.classOverride ?? r.counterpartyClassName ?? hist?.className ?? null,
    // Override → computed default. Default mirrors lib/treasury-transactions
    // exactly (dir capitalized, qty abs, stable-token usd falls back to |qty|)
    // so the posted description equals the list's descriptionDefault.
    description: r.qbState?.description ?? defaultDescription({
      dir: r.txn.direction === 'in' ? 'In' : 'Out',
      asset: r.txn.asset,
      qty: Math.abs(Number(r.txn.qty)),
      usd:
        STABLE_TOKENS.has(r.txn.asset) && r.txn.usd == null
          ? Math.abs(Number(r.txn.qty))
          : r.txn.usd != null
            ? Number(r.txn.usd)
            : null,
      txHash: r.txn.txHash,
    }),
    }
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Grouping
// ────────────────────────────────────────────────────────────────────────────

type IndividualGroup = { kind: 'individual'; tx: LoadedTx }
type BulkGroup = {
  kind: 'bulk'
  walletAddress: string
  token: string
  monthDate: Date // first of the month (UTC)
  monthYyyymm: string
  members: LoadedTx[]
}
type GroupSpec = IndividualGroup | BulkGroup

function yyyymmOf(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

function firstOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

// Group bulk-wallet txs by (wallet, token, year-month). Inflows + outflows in
// the same group share a single JE — buildJournalEntry's main-line aggregator
// emits separate debit/credit pairs per (direction, walletGl, counterpartyGl)
// tuple, so the JE stays balanced regardless of direction mix.
function groupBulkTxs(txs: LoadedTx[]): BulkGroup[] {
  const buckets = new Map<string, BulkGroup>()
  for (const t of txs) {
    const monthDate = firstOfMonthUtc(t.blockTime)
    const monthYyyymm = yyyymmOf(monthDate)
    const key = `${t.walletAddress}::${t.asset}::${monthYyyymm}`
    const existing = buckets.get(key)
    if (existing) {
      existing.members.push(t)
    } else {
      buckets.set(key, {
        kind: 'bulk',
        walletAddress: t.walletAddress,
        token: t.asset,
        monthDate,
        monthYyyymm,
        members: [t],
      })
    }
  }
  return [...buckets.values()]
}

function monthKeyOf(group: GroupSpec): string {
  return group.kind === 'individual'
    ? yyyymmOf(group.tx.blockTime)
    : group.monthYyyymm
}

function memberTxIdsOf(group: GroupSpec): string[] {
  return group.kind === 'individual'
    ? [group.tx.id]
    : group.members.map((m) => m.id)
}

// Bulk description, e.g.
//   `IN - USDC - 23,024.13 USDC - $23,024.13 - 2026-05 - 4 txs`
//   `MIXED (2 in/1 out) - SOL - 12.50 SOL - $1,250.00 - 2026-05 - 3 txs`
// A bulk JE aggregates many txs into shared lines, so there's no single per-tx
// description to copy — we synthesize a group-level one (v1 shape, but
// direction-aware: a V2 bulk group can hold both inflows and outflows of the
// same wallet+token+month). The prefix is IN / OUT / MIXED from the members'
// directions; MIXED spells out the in/out tx counts in parentheses so the gross
// totals aren't ambiguous. Totals are gross (sum of absolute qty/usd). Stable
// tokens show the token quantity as the dollar figure; others show summed USD.
// Used as the JE Memo + every line's Description.
function bulkDescription(group: BulkGroup): string {
  const totalQty = group.members.reduce((s, m) => s + Math.abs(m.qty), 0)
  const totalUsd = group.members.reduce((s, m) => s + Math.abs(m.usd), 0)
  const dispAmt = STABLE_TOKENS.has(group.token)
    ? fmtNum(totalQty, 2)
    : fmtNum(totalUsd, 2)
  const inCount = group.members.filter((m) => m.direction === 'in').length
  const outCount = group.members.length - inCount
  const dirLabel =
    inCount > 0 && outCount > 0
      ? `MIXED (${inCount} in/${outCount} out)`
      : inCount > 0
        ? 'IN'
        : 'OUT'
  return `${dirLabel} - ${group.token} - ${fmtNum(totalQty, 2)} ${group.token} - $${dispAmt} - ${group.monthYyyymm} - ${group.members.length} txs`
}

// The description that becomes the JE Memo + every line's Description.
// Individual: the tx's effective description (override → default). Bulk: the
// synthesized group-level description. Shared by the real post + the preview
// route so both render the same memo.
export function groupDescription(group: GroupSpec): string {
  return group.kind === 'individual'
    ? group.tx.description
    : bulkDescription(group)
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

// Non-executing helper: loads txs, verifies entity ownership, partitions into
// skipped + groups (bulk + individual). Pure read against the DB. Used both by
// `postBatch` (real post path) and by `/api/qb/post-preview` (dry-run modal),
// so the partitioning logic stays DRY between the two.
//
// Throws on validation failures (empty list, batch cap exceeded, entity
// ownership mismatch) — these are surfaced to the user verbatim by the route
// handler.
export async function buildPostPlan(args: {
  entity: QboEntity
  txIds: string[]
}): Promise<{
  groups: GroupSpec[]
  skipped: PostBatchResult['skipped']
}> {
  if (args.txIds.length === 0) {
    throw new Error('No transactions selected')
  }
  if (args.txIds.length > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size exceeds ${MAX_BATCH_SIZE} — post in smaller groups`,
    )
  }

  const dbEntity = toDbEntity(args.entity)
  const txs = await loadTxs(args.txIds)

  // D12 — entity ownership verification. qb:post permission gates by role at
  // the route layer; this guards against a caller who has the permission but
  // submits txIds belonging to a different entity (parameter tampering).
  const foreignTxs = txs.filter((t) => t.entityId !== dbEntity)
  if (foreignTxs.length > 0) {
    throw new Error(
      `Forbidden: ${foreignTxs.length} tx(s) do not belong to entity ${args.entity}`,
    )
  }

  // Partition into skipped / eligible (D5: GL required; D14: voided posts are
  // re-eligible via post-batch — they get a NEW qb_post row).
  const skipped: PostBatchResult['skipped'] = []
  const eligible: LoadedTx[] = []
  for (const t of txs) {
    const walletGl = resolveWalletGl({
      override: t.glAccountOverride,
      perToken: t.perTokenAccountCode,
      default: t.walletAccountCode,
    })
    const effectiveWalletGl = walletGl.code
    if (!effectiveWalletGl) {
      skipped.push({ txId: t.id, reason: 'wallet has no GL account_code' })
      continue
    }
    t.walletGlSource = walletGl.source
    t.walletGl = walletGl.code
    const effectiveCpGl = t.counterpartyGlOverride ?? t.counterpartyGlMapValue
    if (!effectiveCpGl) {
      skipped.push({ txId: t.id, reason: 'no counterparty GL set' })
      continue
    }
    if (t.postId && t.existingPostStatus === 'posted_manually') {
      // Backfill-identified manual post: the JE already exists in QB, posted
      // outside this tool. There's no re-post flow for these; skip to avoid
      // creating a duplicate JE (the whole point of the backfill).
      skipped.push({ txId: t.id, reason: 'already posted manually in QuickBooks' })
      continue
    }
    if (
      t.postId &&
      (t.existingPostStatus === 'posted' ||
        t.existingPostStatus === 'posted_modified')
    ) {
      // Re-posting an already-posted row goes through the re-post flow
      // (void-then-post); we don't let post-batch double-post it.
      skipped.push({ txId: t.id, reason: 'already posted (use Re-post)' })
      continue
    }
    if (t.postId && t.existingPostStatus === 'unposted') {
      // Already reserved and submitted to QB (awaiting background confirmation).
      // Don't fire a second create — the reconciler/after() will confirm it.
      skipped.push({ txId: t.id, reason: 'already submitted — confirming with QuickBooks' })
      continue
    }
    eligible.push(t)
  }

  // Partition eligible into bulk (grouped by wallet+token+month) vs individual
  // (one group per tx).
  const bulkEligible = eligible.filter((t) => t.walletIsBulkTreasury)
  const individualEligible = eligible.filter((t) => !t.walletIsBulkTreasury)
  const groups: GroupSpec[] = [
    ...groupBulkTxs(bulkEligible),
    ...individualEligible.map((tx): IndividualGroup => ({ kind: 'individual', tx })),
  ]

  // Cap on the REAL cost: each group = one journal entry = one QB API call.
  // Bulk-wallet selections of hundreds of txs collapse into a few groups and
  // pass; hundreds of individual txs (hundreds of QB calls) are rejected
  // with guidance, same protection the old flat 50-tx cap provided.
  if (groups.length > MAX_JE_GROUPS) {
    throw new Error(
      `Selection would create ${groups.length} journal entries — max ${MAX_JE_GROUPS} per post. `
      + 'Narrow the selection (each individual-wallet transaction creates its own JE).',
    )
  }

  return { groups, skipped }
}

// Map a LoadedTx to the TxForPost shape consumed by buildJournalEntry. Exposed
// for the preview route so it can synthesize JE shapes without re-doing the
// resolution logic. Caller guarantees walletAccountCode + counterpartyGl are
// non-null (i.e. the tx survived buildPostPlan's eligibility filter).
export function loadedTxToTxForPost(t: LoadedTx): TxForPost {
  return toTxForPost(t, {
    walletAccountCode: t.walletGl as string,
    counterpartyGl: (t.counterpartyGlOverride ?? t.counterpartyGlMapValue) as string,
  })
}

// Re-export so the preview route can pattern-match on group.kind without
// re-declaring its own copy of the type.
export type { GroupSpec, IndividualGroup, BulkGroup, LoadedTx }

// Reserve + build every eligible JE (fast: DB + local only, no QB call), then
// hand the jobs to the caller to fire in the background via after(). Returns
// the immediate response: everything reservable is 'pending' (it posts in the
// background), plus any reserve/build failures and skips. This is what lets
// the request return in ~seconds even while QB takes minutes to create a JE.
export async function preparePostBatch(args: {
  entity: QboEntity
  txIds: string[]
  userId: string
}): Promise<{ jobs: PostJob[] } & PostBatchResult> {
  const { groups, skipped } = await buildPostPlan({ entity: args.entity, txIds: args.txIds })

  const catalog = await readCachedAccountCatalogByNumber(args.entity)
  const resolveAccount: AccountResolver = (accountNumber) => {
    const account = catalog.get(accountNumber)
    if (!account) throw new UnresolvedAccountError(accountNumber)
    return { value: account.qbAccountId, name: account.qbAccountName }
  }
  const classByNameMap = await readCachedClassCatalogByName(args.entity)
  const vendorByNameMap = await readCachedVendorCatalogByName(args.entity)
  const resolveClass: BuildArgs['resolveClass'] = (name) => {
    const r = classByNameMap.get(name)
    return r ? { value: r.qbClassId, name: r.qbClassName } : null
  }
  const resolveVendor: BuildArgs['resolveVendor'] = (name) => {
    const r = vendorByNameMap.get(name)
    return r ? { value: r.qbVendorId } : null
  }
  const writeCpGlSnapshot = await hasPostedCounterpartyGlColumn().catch(() => false)

  const jobs: PostJob[] = []
  const pending: PostBatchResult['pending'] = []
  const failures: PostBatchResult['failures'] = []

  for (const group of groups) {
    try {
      const job = await reserveAndBuildJob(group, args.entity, args.userId, resolveAccount, resolveClass, resolveVendor, writeCpGlSnapshot)
      jobs.push(job)
      pending.push({ postId: job.pendingId, docNumber: job.docNumber, memberTxIds: job.memberTxIds })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      const memberTxIds = memberTxIdsOf(group)
      const docNumber = group.kind === 'individual'
        ? formatIndividualDocNumber(group.tx.blockTime, 0)
        : formatBulkDocNumber(group.token, group.monthDate)
      failures.push({ docNumber, error, memberTxIds })
      logAudit({ userId: args.userId, action: 'qb_post.failed', resourceType: 'qb_post', metadata: { entity: args.entity, error, attemptedTxIds: memberTxIds } })
        .catch(() => { /* swallow */ })
    }
  }

  // successes is empty here — the actual QB creates run in the background; rows
  // flip to posted as the reconciler/after() confirm them.
  return { jobs, successes: [], failures, pending, skipped }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-group transaction: advisory lock + idempotent QB write + persist
// ────────────────────────────────────────────────────────────────────────────

// Look up ONE journal entry by our own DocNumber + TxnDate — a light,
// indexed QBO query (single row). Used ONLY after a failed write to tell
// apart "QB created the JE but the response was lost (504 / stream timeout)"
// from "the JE never landed": if it's there we adopt it, otherwise the post
// failed cleanly and is safe to retry. Bounded (20s); the caller treats any
// error as "could not confirm".
async function findJournalEntryByDocNumber(
  entity: QboEntity,
  docNumber: string,
  txnDate: string,
): Promise<{ Id: string } | null> {
  const safeDoc = docNumber.replace(/'/g, "''")
  const q = `SELECT Id FROM JournalEntry WHERE DocNumber = '${safeDoc}' AND TxnDate = '${txnDate}' MAXRESULTS 1`
  const res = await fetchQboJson<QbQueryResponse<'JournalEntry', { Id: string }>>(
    entity,
    `/v3/company/${getQboRealmId(entity)}/query?query=${encodeURIComponent(q)}&minorversion=65`,
    { timeoutMs: 20_000 },
  )
  return res.QueryResponse?.JournalEntry?.[0] ?? null
}

// Look up ONE journal entry by DocNumber only (no TxnDate) — used by the
// background reconciler, which has the qb_post row (DocNumber) but not the
// original TxnDate. Our TL-{Mon}-JE## numbers are unique per month.
async function findJournalEntryByDocNumberOnly(
  entity: QboEntity,
  docNumber: string,
): Promise<{ Id: string } | null> {
  const safeDoc = docNumber.replace(/'/g, "''")
  const q = `SELECT Id FROM JournalEntry WHERE DocNumber = '${safeDoc}' MAXRESULTS 1`
  const res = await fetchQboJson<QbQueryResponse<'JournalEntry', { Id: string }>>(
    entity,
    `/v3/company/${getQboRealmId(entity)}/query?query=${encodeURIComponent(q)}&minorversion=65`,
    { timeoutMs: 20_000 },
  )
  return res.QueryResponse?.JournalEntry?.[0] ?? null
}

// Link this group's member txs to the qb_post row (postId + posted GL/vendor/
// class snapshot). Done at RESERVE time so the qb_post row is self-contained —
// the background reconciler can adopt it later without needing the group again.
async function linkGroupMembers(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  group: GroupSpec,
  pendingId: string,
  userId: string,
  writeCpGlSnapshot: boolean,
): Promise<void> {
  const members = group.kind === 'individual' ? [group.tx] : group.members
  for (const m of members) {
    await tx
      .insert(txQbState)
      .values({
        txHash: m.txHash,
        walletAddress: m.walletAddress,
        direction: m.direction,
        asset: m.asset,
        entityId: m.entityId,
        postId: pendingId,
        postedGlAccount: m.walletGl,
        postedGlSource: m.walletGlSource,
        postedVendor: m.effectiveVendor,
        postedClass: m.effectiveClass,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: [txQbState.txHash, txQbState.walletAddress, txQbState.direction, txQbState.asset],
        set: {
          postId: pendingId,
          postedGlAccount: m.walletGl,
          postedGlSource: m.walletGlSource,
          postedVendor: m.effectiveVendor,
          postedClass: m.effectiveClass,
          updatedAt: new Date(),
          updatedBy: userId,
        },
      })

    if (writeCpGlSnapshot) {
      const snapshot = m.counterpartyGlOverride ?? m.counterpartyGlMapValue ?? null
      await tx.execute(sql`
        UPDATE "app"."tx_qb_state"
           SET "posted_counterparty_gl" = ${snapshot}
         WHERE "tx_hash" = ${m.txHash}
           AND "wallet_address" = ${m.walletAddress}
           AND "direction" = ${m.direction}
           AND "asset" = ${m.asset}
      `)
    }
  }
}

// A reserved JE ready to be fired at QB. Built (and committed) in the request;
// actually POSTed in the background so the user never waits on QB's slow
// create. The JE body + Request-Id live here so the background worker can
// (re)POST idempotently — Intuit replays the original response for a repeated
// Request-Id, so retrying is safe and never duplicates.
type PostJob = {
  entity: QboEntity
  pendingId: string
  docNumber: string
  jeBody: string
  requestId: string
  txnDate: string
  memberTxIds: string[]
}

// PHASE 1 — RESERVE + LINK + BUILD (short tx; advisory lock held for ms only).
// Commits a durable qb_post row and links its member txs BEFORE any QB call,
// then builds the JE. Returns a PostJob for the background worker. A build
// error (bad account) marks the row failed and rethrows so the caller reports
// a failure.
async function reserveAndBuildJob(
  group: GroupSpec,
  entity: QboEntity,
  userId: string,
  resolveAccount: AccountResolver,
  resolveClass: BuildArgs['resolveClass'],
  resolveVendor: BuildArgs['resolveVendor'],
  writeCpGlSnapshot: boolean,
): Promise<PostJob> {
  const yyyymm = monthKeyOf(group)
  const lockKey = `qb-post:${entity}:${yyyymm}`
  const dbEntity = toDbEntity(entity)
  const memberTxIds = memberTxIdsOf(group)

  const txsForPost = (group.kind === 'individual' ? [group.tx] : group.members).map((t) =>
    toTxForPost(t, {
      walletAccountCode: t.walletGl as string,
      counterpartyGl: (t.counterpartyGlOverride ?? t.counterpartyGlMapValue) as string,
    }),
  )

  const { pendingId, docNumber } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
    const [pending] = await tx
      .insert(qbPost)
      .values({
        entityId: dbEntity,
        docNumber: 'PENDING',
        postingStatus: 'unposted',
        walletAddress: group.kind === 'bulk' ? group.walletAddress : null,
        token: group.kind === 'bulk' ? group.token : null,
        monthYyyymm: yyyymm,
      })
      .returning({ id: qbPost.id })
    const doc =
      group.kind === 'individual'
        ? formatIndividualDocNumber(
            group.tx.blockTime,
            await getNextIndividualSequence(entity, group.tx.blockTime),
          )
        : formatBulkDocNumber(group.token, group.monthDate)
    await tx.update(qbPost).set({ docNumber: doc }).where(eq(qbPost.id, pending.id))
    await linkGroupMembers(tx, group, pending.id, userId, writeCpGlSnapshot)
    return { pendingId: pending.id, docNumber: doc }
  })

  let je: QbJournalEntry
  try {
    je = buildJournalEntry({
      txs: txsForPost,
      docNumber,
      description: groupDescription(group),
      resolveAccount,
      resolveClass,
      resolveVendor,
      gainLossGl: gainLossGlForEntity(entity),
    })
  } catch (buildErr) {
    await db.update(qbPost)
      .set({ postingStatus: 'failed', postingError: buildErr instanceof Error ? buildErr.message : String(buildErr) })
      .where(eq(qbPost.id, pendingId))
    throw buildErr
  }

  // Intuit idempotency key MUST be a URL query parameter (requestid=…); the
  // header form is not honored. Unique per company; ≤50 chars.
  const requestId = (group.kind === 'individual' ? `tl-${group.tx.txHash}` : `tl-${docNumber}`)
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 50)

  return { entity, pendingId, docNumber, jeBody: JSON.stringify(je), requestId, txnDate: je.TxnDate, memberTxIds }
}

async function markPosted(pendingId: string, qbJournalEntryId: string, userId: string, docNumber: string, entity: QboEntity, memberTxIds: string[]): Promise<void> {
  await db.update(qbPost)
    .set({ qbJournalEntryId, postingStatus: 'posted', postingError: null, postedAt: new Date(), postedBy: userId })
    .where(eq(qbPost.id, pendingId))
  logAudit({ userId, action: 'qb_post.create', resourceType: 'qb_post', resourceId: pendingId, metadata: { entity, docNumber, qbJournalEntryId, memberTxIds } })
    .catch(() => { /* swallow */ })
}

// PHASE 2 — FIRE & CONFIRM (background, in after()). POSTs the JE with the
// Request-Id as a URL query param. On Intuit's slow-create 504/stream-timeout,
// it RE-POSTs the same request (same requestid) with backoff: Intuit replays
// the original response (returns the created JE) once the create finishes, so
// this confirms reliably WITHOUT depending on QB's laggy query index, and
// never duplicates. Leaves the row reserved if it can't confirm in the budget
// (the reconciler / next post finishes it).
async function runJob(job: PostJob, userId: string): Promise<void> {
  const url = `/v3/company/${getQboRealmId(job.entity)}/journalentry?minorversion=65&requestid=${encodeURIComponent(job.requestId)}`
  const deadline = Date.now() + 240_000
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    try {
      const resp = await fetchQboJson<QbJournalEntryResponse>(
        job.entity,
        url,
        { method: 'POST', body: job.jeBody, requestId: job.requestId, timeoutMs: 90_000 },
      )
      await markPosted(job.pendingId, resp.JournalEntry.Id, userId, job.docNumber, job.entity, job.memberTxIds)
      return
    } catch (postErr) {
      const status = (postErr as { status?: number }).status
      if (typeof status === 'number' && status >= 400 && status < 500) {
        await db.update(qbPost)
          .set({ postingStatus: 'failed', postingError: postErr instanceof Error ? postErr.message : String(postErr) })
          .where(eq(qbPost.id, job.pendingId))
        return
      }
      logAudit({
        userId,
        action: 'qb_post.create_response_lost',
        resourceType: 'qb_post',
        resourceId: job.pendingId,
        metadata: { entity: job.entity, docNumber: job.docNumber, attempt, error: postErr instanceof Error ? postErr.message : String(postErr) },
      }).catch(() => { /* swallow */ })
      if (Date.now() + 12000 >= deadline) break
      await new Promise((r) => setTimeout(r, 10000))
    }
  }
  // Not confirmed in the background budget — leave it reserved with a note.
  await db.update(qbPost)
    .set({ postingError: 'Submitted to QuickBooks — awaiting confirmation (QB is slow right now).' })
    .where(eq(qbPost.id, job.pendingId))
    .catch(() => { /* swallow */ })
}

// Run reserved jobs in the background (via after()) so the request returns
// immediately. Sequential — each JE is one QB create.
export async function runJobsBackground(jobs: PostJob[], userId: string): Promise<void> {
  for (const job of jobs) {
    await runJob(job, userId).catch(() => { /* isolate per-job */ })
  }
  // Sweep anything still unconfirmed (e.g. earlier pendings) best-effort.
  if (jobs[0]) await reconcileEntity(jobs[0].entity, userId).catch(() => { /* swallow */ })
}

// Background reconciliation: adopt JEs that QB created but never confirmed to
// us in time. Finds reserved-but-unconfirmed qb_post rows (status 'unposted'
// with a real DocNumber) and, for each, checks whether QB now has the JE;
// if so, flips the row to 'posted'. Members are already linked at reserve, so
// this alone makes the transaction show as posted. Safe to call repeatedly.
export async function reconcileEntity(
  entity: QboEntity,
  userId: string,
): Promise<{ adopted: number; docNumbers: string[] }> {
  const dbEntity = toDbEntity(entity)
  const rows = await db
    .select({ id: qbPost.id, docNumber: qbPost.docNumber })
    .from(qbPost)
    .where(and(
      eq(qbPost.entityId, dbEntity),
      eq(qbPost.postingStatus, 'unposted'),
      ne(qbPost.docNumber, 'PENDING'),
    ))
    .limit(40)

  const docNumbers: string[] = []
  for (const row of rows) {
    const found = await findJournalEntryByDocNumberOnly(entity, row.docNumber).catch(() => null)
    if (!found) continue
    await db.update(qbPost)
      .set({ qbJournalEntryId: found.Id, postingStatus: 'posted', postingError: null, postedAt: new Date(), postedBy: userId })
      .where(eq(qbPost.id, row.id))
    docNumbers.push(row.docNumber)
    logAudit({
      userId,
      action: 'qb_post.reconciled',
      resourceType: 'qb_post',
      resourceId: row.id,
      metadata: { entity, docNumber: row.docNumber, qbJournalEntryId: found.Id },
    }).catch(() => { /* swallow */ })
  }
  return { adopted: docNumbers.length, docNumbers }
}

// ────────────────────────────────────────────────────────────────────────────
// QB helpers
// ────────────────────────────────────────────────────────────────────────────

// Adopts a prior orphan JE on retry (D11). Returns null if no JE in QB carries
// the given PrivateNote.
//
// NOTE: Currently unused — QB's QBOQL does NOT support `WHERE PrivateNote = …`
// and returns 400 QueryParserError, which previously blocked the entire post
// flow (see Wave 2c hotfix). Kept here as scaffolding for the Wave 2d
// idempotency rework, which will switch to DocNumber-based retry adoption
// (a field QB DOES support in QBOQL).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function findQbJeByPrivateNote(
  entity: QboEntity,
  note: string,
): Promise<{ Id: string; SyncToken?: string } | null> {
  const realmId = getQboRealmId(entity)
  // Escape single quotes for QB's SQL-ish query syntax. UUIDs from defaultRandom
  // never contain quotes, but be defensive — the cost is one regex.
  const safeNote = note.replace(/'/g, "''")
  const q = `SELECT Id, SyncToken FROM JournalEntry WHERE PrivateNote = '${safeNote}' MAXRESULTS 1`
  const res = await fetchQboJson<
    QbQueryResponse<'JournalEntry', { Id: string; SyncToken?: string }>
  >(
    entity,
    `/v3/company/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=65`,
  )
  return res.QueryResponse?.JournalEntry?.[0] ?? null
}

function toTxForPost(
  t: LoadedTx,
  resolved: { walletAccountCode: string; counterpartyGl: string },
): TxForPost {
  return {
    id: t.id,
    txHash: t.txHash,
    direction: t.direction,
    asset: t.asset,
    qty: t.qty,
    usd: t.usd,
    blockTime: t.blockTime,
    walletAccountCode: resolved.walletAccountCode,
    counterpartyGl: resolved.counterpartyGl,
    counterpartyLabel: t.counterpartyLabel,
    vendorName: t.effectiveVendor,
    className: t.effectiveClass,
    gain: {
      stGain: t.gainStGain != null ? Number(t.gainStGain) : null,
      ltGain: t.gainLtGain != null ? Number(t.gainLtGain) : null,
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Void (D14)
// ────────────────────────────────────────────────────────────────────────────

export async function voidPost(args: {
  postId: string
  userId: string
}): Promise<void> {
  // Load the post row first. We want to short-circuit idempotently for
  // already-voided / never-posted rows before talking to QB at all.
  const [row] = await db
    .select({
      id: qbPost.id,
      entityId: qbPost.entityId,
      docNumber: qbPost.docNumber,
      qbJournalEntryId: qbPost.qbJournalEntryId,
      postingStatus: qbPost.postingStatus,
    })
    .from(qbPost)
    .where(eq(qbPost.id, args.postId))
    .limit(1)

  if (!row) {
    throw new Error(`qb_post ${args.postId} not found`)
  }

  // Idempotent no-ops — never sent or already cancelled.
  if (row.postingStatus === 'voided' || row.postingStatus === 'unposted') {
    return
  }
  if (!row.qbJournalEntryId) {
    // 'posted' / 'posted_modified' / 'failed' without a JE id shouldn't happen
    // by construction, but if it does, just flip status — nothing in QB to void.
    await db
      .update(qbPost)
      .set({ postingStatus: 'voided' })
      .where(eq(qbPost.id, args.postId))
    return
  }

  // Translate db entity_id back to display QboEntity. qbPost.entityId is
  // stored lowercase ('opco'); QboEntity is capitalized ('Opco'). The realm
  // resolver keys off the capitalized form.
  const entity = dbEntityToQboEntity(row.entityId)
  if (!entity) {
    throw new Error(`qb_post ${args.postId} has unknown entity ${row.entityId}`)
  }

  // To void, QB requires a fresh SyncToken. Schema doesn't stash it (would
  // require a migration), so we GET the current JE first. This costs one extra
  // round-trip vs storing SyncToken at post-time, but avoids a stale-token
  // race if the JE was ever touched out-of-band in the QB UI.
  const realmId = getQboRealmId(entity)
  const getRes = await fetchQboJson<{
    JournalEntry?: { Id: string; SyncToken?: string }
  }>(
    entity,
    `/v3/company/${realmId}/journalentry/${encodeURIComponent(row.qbJournalEntryId)}?minorversion=65`,
  )
  const current = getRes.JournalEntry
  if (!current) {
    throw new Error(
      `JournalEntry ${row.qbJournalEntryId} not found in QB ${entity}`,
    )
  }
  const syncToken = current.SyncToken ?? '0'

  // Void semantics per D14: operation=void leaves the JE visible in QB with
  // $0 amounts and a Voided flag — audit trail intact. NOT operation=delete.
  await fetchQboJson<QbJournalEntryResponse>(
    entity,
    `/v3/company/${realmId}/journalentry?operation=void&minorversion=65`,
    {
      method: 'POST',
      body: JSON.stringify({
        Id: row.qbJournalEntryId,
        SyncToken: syncToken,
      }),
    },
  )

  // Flip our side. KEEP qb_journal_entry_id (so "View in QB" still resolves —
  // D14) and KEEP members' post_id FK (so the historical link survives in
  // drill-down; a subsequent re-post creates a NEW qb_post and re-points members
  // at it, leaving this row as audit history).
  await db
    .update(qbPost)
    .set({ postingStatus: 'voided' })
    .where(eq(qbPost.id, args.postId))

  // Capture the member tx IDs for the audit record. Inexpensive — the same
  // index used by the drill-down UI covers this.
  const memberRows = await db
    .select({
      txHash: txQbState.txHash,
      walletAddress: txQbState.walletAddress,
      direction: txQbState.direction,
      asset: txQbState.asset,
    })
    .from(txQbState)
    .where(eq(txQbState.postId, args.postId))
  const memberTxIds = memberRows.map(
    (m) => `${m.txHash}:${m.walletAddress}:${m.direction}:${m.asset}`,
  )

  logAudit({
    userId: args.userId,
    action: 'qb_post.void',
    resourceType: 'qb_post',
    resourceId: args.postId,
    metadata: {
      entity,
      qbJournalEntryId: row.qbJournalEntryId,
      docNumber: row.docNumber,
      memberTxIds,
      voidedBy: args.userId,
    },
  }).catch(() => {
    /* swallow */
  })
}

// Translate stored entity_id ('opco') → QboEntity ('Opco'). Returns null if
// the id doesn't map to a known QBO entity (e.g. 'external').
function dbEntityToQboEntity(dbEntityId: string): QboEntity | null {
  const candidates: QboEntity[] = ['Opco', 'Foundation', 'Juku', 'Zagreus']
  return candidates.find((c) => toDbEntity(c) === dbEntityId) ?? null
}
