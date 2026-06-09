import { and, eq, inArray, sql } from 'drizzle-orm'
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
import { buildJournalEntry, type TxForPost } from './post-journal-entry.ts'
import {
  formatBulkDocNumber,
  formatIndividualDocNumber,
  getNextIndividualSequence,
} from './doc-number.ts'
import { getQbVendors, matchVendorByLabel } from './vendor-match.ts'
import type {
  QbJournalEntry,
  QbJournalEntryResponse,
  QbQueryResponse,
} from './types.ts'
import { resolveWalletGl, type GlSource } from './resolve-wallet-gl'

// D13 — server-enforced hard cap. Mirror of the UI cap in
// components/transactions-page-client.tsx; rejecting a >50 request here is
// defense against client tampering / direct API calls.
const MAX_BATCH_SIZE = 50

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
}

async function loadTxs(txIds: string[]): Promise<LoadedTx[]> {
  // Counterparty wallet alias — counterparty is just an address; if a known
  // wallet matches we surface its label for vendor matching.
  const cpWallet = alias(wallet, 'cp_wallet')

  const rows = await db
    .select({
      txn: transaction,
      walletAccountCode: wallet.accountCode,
      walletIsBulkTreasury: wallet.isBulkTreasury,
      counterpartyLabel: cpWallet.label,
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
        postId: txQbState.postId,
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

  return rows.map((r): LoadedTx => ({
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
    counterpartyGlMapValue: r.counterpartyGl?.glAccountNumber ?? null,
    postId: r.qbState?.postId ?? null,
    existingPostStatus: r.existingPostStatus ?? null,
    gainStGain: r.gain?.stGain ?? null,
    gainLtGain: r.gain?.ltGain ?? null,
    perTokenAccountCode:
      perTokenMap.get(`${r.txn.walletAddress}::${r.txn.asset}`) ?? null,
    walletGlSource: null, // populated by buildPostPlan eligibility loop
    walletGl: null, // populated by buildPostPlan eligibility loop
  }))
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

export async function postBatch(args: {
  entity: QboEntity
  txIds: string[]
  userId: string
}): Promise<PostBatchResult> {
  // D13 — batch cap is enforced inside buildPostPlan; we delegate the whole
  // load+verify+partition step so postBatch and post-preview stay aligned.
  const { groups, skipped } = await buildPostPlan({
    entity: args.entity,
    txIds: args.txIds,
  })

  const successes: PostBatchResult['successes'] = []
  const failures: PostBatchResult['failures'] = []

  // D9 — partial-failure tolerant: iterate groups sequentially, isolate errors
  // per JE. Successful groups commit independently of failed ones.
  for (const group of groups) {
    try {
      const result = await postOneGroupLocked(group, args.entity, args.userId)
      successes.push(result)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      const memberTxIds = memberTxIdsOf(group)
      // We may not have a final DocNumber if we failed before computing it.
      // Best-effort: produce the would-be DocNumber for display. Sequence "0"
      // signals "never assigned" to the UI without crashing the result shape.
      const docNumber =
        group.kind === 'individual'
          ? formatIndividualDocNumber(group.tx.blockTime, 0)
          : formatBulkDocNumber(group.token, group.monthDate)
      failures.push({ docNumber, error, memberTxIds })

      logAudit({
        userId: args.userId,
        action: 'qb_post.failed',
        resourceType: 'qb_post',
        metadata: { entity: args.entity, error, attemptedTxIds: memberTxIds },
      }).catch(() => {
        /* swallow */
      })
    }
  }

  return { successes, failures, skipped }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-group transaction: advisory lock + idempotent QB write + persist
// ────────────────────────────────────────────────────────────────────────────

async function postOneGroupLocked(
  group: GroupSpec,
  entity: QboEntity,
  userId: string,
): Promise<PostBatchResult['successes'][number]> {
  const yyyymm = monthKeyOf(group)
  // D6 — lock scoped per (entity, year-month) so concurrent users posting to
  // different months don't block each other. Auto-released on tx commit/rollback.
  const lockKey = `qb-post:${entity}:${yyyymm}`
  const dbEntity = toDbEntity(entity)

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    )

    // D11 — pre-allocate the qb_post row BEFORE talking to QB. The row's UUID
    // becomes our idempotency key (embedded in QB's PrivateNote on the JE we
    // POST). If we fail between QB ack and DB commit, the retry can find the
    // orphan JE via that note and adopt it instead of duplicating.
    const [pending] = await tx
      .insert(qbPost)
      .values({
        entityId: dbEntity,
        docNumber: 'PENDING', // overwritten once sequence is assigned below
        postingStatus: 'unposted',
        walletAddress: group.kind === 'bulk' ? group.walletAddress : null,
        token: group.kind === 'bulk' ? group.token : null,
        monthYyyymm: yyyymm,
      })
      .returning({ id: qbPost.id })

    // Sequence query runs INSIDE the advisory lock — two concurrent posts to
    // the same (entity, year-month) will serialize here, preventing duplicate
    // sequence assignment.
    const docNumber =
      group.kind === 'individual'
        ? formatIndividualDocNumber(
            group.tx.blockTime,
            await getNextIndividualSequence(entity, group.tx.blockTime),
          )
        : formatBulkDocNumber(group.token, group.monthDate)

    await tx
      .update(qbPost)
      .set({ docNumber })
      .where(eq(qbPost.id, pending.id))

    // TODO: Idempotency check removed — PrivateNote is not queryable in QB
    // QBOQL (returns 400 QueryParserError, blocking the whole post). Proper
    // idempotency to be implemented in Wave 2d using DocNumber-based detection
    // (pre-allocate qb_post with status='posting' + DocNumber, retry-adopt by
    // DocNumber query). Until then, the duplicate-scan immediately after POST
    // (below) is our detection layer. PrivateNote is still set on outbound JEs
    // (in buildJournalEntry) as a manual-audit trail in QB's UI.
    //
    // Resolve vendor refs (out-direction members with a labelled counterparty
    // get matched against QB's vendor list; matches attach EntityRef to the
    // AP-side line in buildJournalEntry).
    const vendorEntityRef = await resolveVendorRef(entity, group)

    const txsForPost = (group.kind === 'individual'
      ? [group.tx]
      : group.members
    ).map((t) =>
      toTxForPost(t, {
        // t.walletGl is set by buildPostPlan's eligibility loop; all txs in
        // a group passed that loop so the non-null assertion is safe here.
        walletAccountCode: t.walletGl as string,
        counterpartyGl: (t.counterpartyGlOverride ?? t.counterpartyGlMapValue) as string,
      }),
    )

    const je: QbJournalEntry = buildJournalEntry({
      txs: txsForPost,
      docNumber,
      vendorEntityRef,
      privateNote: pending.id,
    })

    const resp = await fetchQboJson<QbJournalEntryResponse>(
      entity,
      `/v3/company/${getQboRealmId(entity)}/journalentry?minorversion=65`,
      { method: 'POST', body: JSON.stringify(je) },
    )
    const qbJournalEntryId = resp.JournalEntry.Id

    // Inline duplicate scan — the POST already succeeded. Query QB: how many
    // JEs exist with this exact DocNumber + TxnDate? Expected 1 (the one we
    // just created). If > 1, a prior attempt also succeeded and the user is
    // now looking at a duplicate in QB books to manually void.
    //
    // We re-derive txnDate the same way buildJournalEntry does (earliest
    // blockTime across members, UTC YYYY-MM-DD) so the query matches the
    // JE we just submitted.
    const txnDateIso = je.TxnDate
    let duplicateDetected = false
    try {
      const safeDoc = docNumber.replace(/'/g, "''")
      const dupQuery = `SELECT Id FROM JournalEntry WHERE DocNumber = '${safeDoc}' AND TxnDate = '${txnDateIso}'`
      const dupRes = await fetchQboJson<
        QbQueryResponse<'JournalEntry', { Id: string }>
      >(
        entity,
        `/v3/company/${getQboRealmId(entity)}/query?query=${encodeURIComponent(dupQuery)}&minorversion=65`,
      )
      const matches = dupRes.QueryResponse?.JournalEntry ?? []
      const matchCount = matches.length
      duplicateDetected = matchCount > 1
      if (duplicateDetected) {
        const otherJeIds = matches
          .filter((m) => m.Id !== qbJournalEntryId)
          .map((m) => m.Id)
        logAudit({
          userId,
          action: 'qb_post.duplicate_detected',
          resourceType: 'qb_post',
          resourceId: pending.id,
          metadata: {
            entity,
            docNumber,
            qbJournalEntryId,
            txnDate: txnDateIso,
            matchCount,
            otherJeIds,
          },
        }).catch(() => {
          /* swallow */
        })
      }
    } catch (dupErr) {
      // Dup-check is best-effort. The POST already succeeded — a network
      // hiccup on the query side must NOT fail the whole post. Just record
      // the miss and continue with the normal success path.
      logAudit({
        userId,
        action: 'qb_post.duplicate_check_failed',
        resourceType: 'qb_post',
        resourceId: pending.id,
        metadata: {
          entity,
          docNumber,
          qbJournalEntryId,
          txnDate: txnDateIso,
          error: dupErr instanceof Error ? dupErr.message : String(dupErr),
        },
      }).catch(() => {
        /* swallow */
      })
    }

    // Persist success on the pre-allocated row
    const memberTxIds = memberTxIdsOf(group)
    await tx
      .update(qbPost)
      .set({
        qbJournalEntryId,
        postingStatus: 'posted',
        postedAt: new Date(),
        postedBy: userId,
        ...(duplicateDetected ? { duplicateWarningAt: new Date() } : {}),
      })
      .where(eq(qbPost.id, pending.id))

    // Link members. A tx_qb_state row may already exist (created by a prior
    // description/GL edit) OR it may not (untouched tx being posted directly).
    // Upsert handles both: insert if missing, otherwise just set post_id.
    const members =
      group.kind === 'individual' ? [group.tx] : group.members
    for (const m of members) {
      await tx
        .insert(txQbState)
        .values({
          txHash: m.txHash,
          walletAddress: m.walletAddress,
          direction: m.direction,
          asset: m.asset,
          entityId: m.entityId,
          postId: pending.id,
          postedGlAccount: m.walletGl,
          postedGlSource: m.walletGlSource,
          updatedAt: new Date(),
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [
            txQbState.txHash,
            txQbState.walletAddress,
            txQbState.direction,
            txQbState.asset,
          ],
          // Only touch post_id + posted GL snapshot + audit columns — preserve
          // any description / override fields the user previously set on this
          // tx_qb_state row.
          // Bulk members share one (wallet, token) ⇒ one GL; individual txs each
          // carry their own resolved value. Either way we read from m.walletGl /
          // m.walletGlSource (set per-member by buildPostPlan's eligibility loop).
          set: {
            postId: pending.id,
            postedGlAccount: m.walletGl,
            postedGlSource: m.walletGlSource,
            updatedAt: new Date(),
            updatedBy: userId,
          },
        })
    }

    logAudit({
      userId,
      action: 'qb_post.create',
      resourceType: 'qb_post',
      resourceId: pending.id,
      metadata: { entity, docNumber, qbJournalEntryId, memberTxIds },
    }).catch(() => {
      /* swallow */
    })

    return {
      postId: pending.id,
      docNumber,
      qbJournalEntryId,
      memberTxIds,
      ...(duplicateDetected ? { duplicateWarning: true } : {}),
    }
  })
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

async function resolveVendorRef(
  entity: QboEntity,
  group: GroupSpec,
): Promise<{ type: 'Vendor'; value: string } | null> {
  // Vendor refs only matter on outflows. For bulk groups with a mix of inflows
  // + outflows + multiple counterparties, the JE's main-line aggregator already
  // splits per (direction, walletGl, counterpartyGl) tuple — but our current
  // buildJournalEntry API takes a single optional vendorEntityRef and attaches
  // it to every AP-side Debit line. Strategy: if ALL outflow members of the
  // group share the same counterparty label that matches a QB vendor, attach
  // it. Otherwise (mixed counterparties, no match), pass null. Mixed-vendor
  // bulks lose vendor attachment — a known limitation matching v1.
  const members = group.kind === 'individual' ? [group.tx] : group.members
  const outMembers = members.filter((m) => m.direction === 'out')
  if (outMembers.length === 0) return null

  // Collect distinct non-empty counterparty labels across outflows.
  const labels = new Set<string>()
  for (const m of outMembers) {
    if (m.counterpartyLabel && m.counterpartyLabel.trim()) {
      labels.add(m.counterpartyLabel.trim())
    }
  }
  if (labels.size !== 1) return null

  const label = [...labels][0]
  const vendors = await getQbVendors(entity)
  const match = matchVendorByLabel(label, vendors)
  if (!match) return null
  return { type: 'Vendor', value: match.Id }
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
