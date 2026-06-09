#!/usr/bin/env bun
/**
 * One-time reconciliation backfill: identify transactions that were already
 * posted to QuickBooks manually (or by the legacy v1 app) and mark them in
 * tidelog as `posted_manually`. This makes the UI highlight them and the
 * post-batch flow skip them (buildPostPlan treats post_id + 'posted_manually'
 * as "already in QB" — see lib/qb/post-batch.ts), preventing double-posting.
 *
 * Strategy (verified by a prior investigation):
 *   - 2026+ QB JournalEntries carry the full 88-char base58 Solana tx hash in
 *     PrivateNote AND in line descriptions (Line[].Description). Bulk JEs list
 *     each member hash across multiple line descriptions.
 *   - ~85% of JEs carry a hash; the rest are bulk aggregates / non-tx
 *     accounting entries (accruals, adjustments) with NO hash — those are
 *     skipped silently, never errored.
 *
 * Usage:
 *   bun run scripts/backfill-manual-qb-posts.ts <Entity> [--commit]
 *
 *   <Entity>   one of Opco | Foundation | Juku | Zagreus
 *   --commit   perform writes. Default is a dry-run that writes nothing.
 *
 * Idempotent & re-runnable: a second --commit run creates no duplicate qb_post
 * rows (qb_journal_entry_id is the idempotency key) and never re-links an
 * already-linked tx (the post_id-null guard).
 *
 * Targets DATABASE_URL by default (set via .env.local; prod scripts wrap this).
 * You CANNOT run this in a sandbox — it needs the prod DB and live QB tokens.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbPost, txQbState, transaction } from '@/lib/db/schema'
import { toDbEntity } from '@/lib/entity'
import { fetchQboJson } from '@/lib/qb/client'
import {
  QBO_ENTITIES,
  getQboRealmId,
  isQboEntity,
  type QboEntity,
} from '@/lib/qb/config'
import type { QbJournalEntry, QbQueryResponse } from '@/lib/qb/types'

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 1000
const TXN_DATE_FROM = '2026-01-01'
// Solana signatures are 86-88 base58 chars; 40+ is a safe floor that won't
// match short account-code / amount tokens while still catching every sig.
const BASE58_TOKEN = /[1-9A-HJ-NP-Za-km-z]{40,}/g

// ────────────────────────────────────────────────────────────────────────────
// Args
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { entity: QboEntity; commit: boolean } {
  const positional: string[] = []
  let commit = false
  for (const a of argv) {
    if (a === '--commit') commit = true
    else positional.push(a)
  }
  const entityArg = positional[0]
  if (!entityArg) {
    console.error(
      `Usage: bun run scripts/backfill-manual-qb-posts.ts <Entity> [--commit]\n` +
        `  <Entity> one of: ${QBO_ENTITIES.join(', ')}`,
    )
    process.exit(1)
  }
  if (!isQboEntity(entityArg)) {
    console.error(
      `Invalid entity "${entityArg}". Must be one of: ${QBO_ENTITIES.join(', ')}`,
    )
    process.exit(1)
  }
  return { entity: entityArg, commit }
}

// ────────────────────────────────────────────────────────────────────────────
// QB harvesting
// ────────────────────────────────────────────────────────────────────────────

// Page through all JEs for the entity from TXN_DATE_FROM. QB query pagination
// is 1-indexed STARTPOSITION; loop until a page returns < PAGE_SIZE rows.
async function fetchAllJournalEntries(entity: QboEntity): Promise<QbJournalEntry[]> {
  const realmId = getQboRealmId(entity)
  const all: QbJournalEntry[] = []
  let start = 1
  for (;;) {
    const query =
      `SELECT * FROM JournalEntry WHERE TxnDate >= '${TXN_DATE_FROM}' ` +
      `ORDERBY TxnDate MAXRESULTS ${PAGE_SIZE} STARTPOSITION ${start}`
    const res = await fetchQboJson<QbQueryResponse<'JournalEntry', QbJournalEntry>>(
      entity,
      `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`,
    )
    const page = res.QueryResponse?.JournalEntry ?? []
    all.push(...page)
    console.log(
      `  fetched page @ STARTPOSITION ${start}: ${page.length} JEs (running total ${all.length})`,
    )
    if (page.length < PAGE_SIZE) break
    start += PAGE_SIZE
  }
  return all
}

// Recursively walk any JSON value collecting base58 tokens >= 40 chars from
// every string it encounters. Covers PrivateNote, Line[].Description and any
// other nested string the JE might carry.
function harvestHashesFromValue(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    const matches = value.match(BASE58_TOKEN)
    if (matches) for (const m of matches) out.add(m)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) harvestHashesFromValue(v, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) harvestHashesFromValue(v, out)
  }
}

function harvestHashes(je: QbJournalEntry): string[] {
  const out = new Set<string>()
  harvestHashesFromValue(je, out)
  return [...out]
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

type MatchedRow = {
  txHash: string
  walletAddress: string
  direction: 'in' | 'out'
  asset: string
  entityId: string
}

async function main() {
  const { entity, commit } = parseArgs(process.argv.slice(2))
  const dbEntity = toDbEntity(entity)
  const realmId = getQboRealmId(entity)
  const WOULD = commit ? '' : 'WOULD '

  console.log(
    `\n=== Backfill manual QB posts — ${entity} (realm ${realmId}) — ` +
      `${commit ? 'COMMIT' : 'DRY-RUN'} ===\n`,
  )

  // 1. Page through QB JEs.
  console.log('Fetching JournalEntries from QB…')
  const jes = await fetchAllJournalEntries(entity)

  // 2. Harvest hashes per JE.
  let hashlessJeCount = 0
  let jesWithHash = 0
  const allHashes = new Set<string>()
  // hash -> set of JE ids that referenced it (for reporting & matching)
  const hashToJes = new Map<string, QbJournalEntry[]>()
  // JE id -> hashes it produced (for the per-JE upsert step)
  const jeHashes = new Map<string, string[]>()

  for (const je of jes) {
    const hashes = harvestHashes(je)
    if (hashes.length === 0) {
      hashlessJeCount += 1
      continue
    }
    jesWithHash += 1
    jeHashes.set(je.Id ?? '', hashes)
    for (const h of hashes) {
      allHashes.add(h)
      const list = hashToJes.get(h)
      if (list) list.push(je)
      else hashToJes.set(h, [je])
    }
  }

  // 3. Match harvested hashes to tidelog transaction rows for this entity.
  const hashList = [...allHashes]
  const matchedRows: MatchedRow[] = []
  // Batch the IN() to keep the query reasonable.
  const CHUNK = 500
  for (let i = 0; i < hashList.length; i += CHUNK) {
    const chunk = hashList.slice(i, i + CHUNK)
    if (chunk.length === 0) continue
    const rows = await db
      .select({
        txHash: transaction.txHash,
        walletAddress: transaction.walletAddress,
        direction: transaction.direction,
        asset: transaction.asset,
        entityId: transaction.entityId,
      })
      .from(transaction)
      .where(
        and(
          inArray(transaction.txHash, chunk),
          eq(transaction.entityId, dbEntity),
        ),
      )
    matchedRows.push(...rows)
  }

  // hash -> matched tidelog rows
  const hashToRows = new Map<string, MatchedRow[]>()
  for (const r of matchedRows) {
    const list = hashToRows.get(r.txHash)
    if (list) list.push(r)
    else hashToRows.set(r.txHash, [r])
  }

  const matchedHashes = hashList.filter((h) => hashToRows.has(h))
  const unmatchedHashes = hashList.filter((h) => !hashToRows.has(h))
  const multiRowHashes = matchedHashes.filter(
    (h) => (hashToRows.get(h)?.length ?? 0) > 1,
  )

  // 4. Writes (only with --commit).
  let qbPostsCreated = 0
  let qbPostsReused = 0
  let stateLinked = 0
  let stateSkippedAlreadyLinked = 0

  // Process per JE that produced >= 1 matched tidelog row. One qb_post per JE,
  // keyed on qb_journal_entry_id for idempotency.
  for (const je of jes) {
    const jeId = je.Id
    if (!jeId) continue
    const hashes = jeHashes.get(jeId)
    if (!hashes || hashes.length === 0) continue

    // Collect all tidelog rows matched by this JE's hashes. A manual JE books
    // the whole economic event, so we mark every leg of every member tx.
    // Dedupe by the tx_qb_state PK — the same leg can surface via multiple
    // line descriptions / harvested tokens, but it's one row to link.
    const rowsByPk = new Map<string, MatchedRow>()
    for (const h of hashes) {
      const rows = hashToRows.get(h)
      if (!rows) continue
      for (const r of rows) {
        rowsByPk.set(`${r.txHash}::${r.walletAddress}::${r.direction}::${r.asset}`, r)
      }
    }
    const rowsForJe = [...rowsByPk.values()]
    if (rowsForJe.length === 0) continue // JE matched no tidelog tx for this entity

    if (!commit) {
      // Dry-run accounting only. We can't know reuse-vs-create without reading,
      // so report it as a single qb_post per matching JE and count would-be links.
      qbPostsCreated += 1
      stateLinked += rowsForJe.length
      continue
    }

    // --- COMMIT PATH ---
    // Idempotency: reuse an existing qb_post row with this entity + JE id.
    const [existing] = await db
      .select({ id: qbPost.id })
      .from(qbPost)
      .where(
        and(
          eq(qbPost.entityId, dbEntity),
          eq(qbPost.qbJournalEntryId, jeId),
        ),
      )
      .limit(1)

    let postId: string
    if (existing) {
      postId = existing.id
      qbPostsReused += 1
    } else {
      const [created] = await db
        .insert(qbPost)
        .values({
          entityId: dbEntity,
          docNumber: je.DocNumber ?? '(manual)',
          qbJournalEntryId: jeId,
          postingStatus: 'posted_manually',
          // JE.TxnDate is a YYYY-MM-DD string; new Date() parses it as UTC
          // midnight, which is the intended posting day.
          postedAt: je.TxnDate ? new Date(je.TxnDate) : null,
          // wallet/token/month left null; posted_by null (no user).
        })
        .returning({ id: qbPost.id })
      postId = created.id
      qbPostsCreated += 1
    }

    // Link each matched tx_qb_state row to this qb_post — but ONLY where
    // post_id is currently NULL. Never clobber an existing post_id (could be a
    // real feature-post). Insert if the row doesn't exist yet (created lazily).
    for (const r of rowsForJe) {
      const result = await db
        .insert(txQbState)
        .values({
          txHash: r.txHash,
          walletAddress: r.walletAddress,
          direction: r.direction,
          asset: r.asset,
          entityId: r.entityId,
          postId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            txQbState.txHash,
            txQbState.walletAddress,
            txQbState.direction,
            txQbState.asset,
          ],
          set: { postId, updatedAt: new Date() },
          // CRITICAL: only set post_id where it is currently NULL.
          setWhere: isNull(txQbState.postId),
        })
        .returning({ postId: txQbState.postId })

      // If the conflict row already had a non-null post_id, setWhere filtered
      // the UPDATE out and nothing is returned — count it as skipped.
      if (result.length > 0) stateLinked += 1
      else stateSkippedAlreadyLinked += 1
    }
  }

  // ── Report (printed in BOTH modes) ──────────────────────────────────────
  console.log(`\n──────────────────── REPORT ────────────────────`)
  console.log(`Entity:                 ${entity}  (db: ${dbEntity}, realm: ${realmId})`)
  console.log(`Mode:                   ${commit ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`\nJEs scanned:            ${jes.length}`)
  console.log(`JEs with >= 1 hash:     ${jesWithHash}`)
  console.log(`Hashless JEs (skipped): ${hashlessJeCount}`)
  console.log(`\nDistinct hashes harvested: ${allHashes.size}`)
  console.log(`  matched to tidelog txs:  ${matchedHashes.length}`)
  console.log(`  unmatched:               ${unmatchedHashes.length}`)

  if (unmatchedHashes.length > 0) {
    console.log(`\nFirst ${Math.min(20, unmatchedHashes.length)} unmatched hashes (other entities or txs tidelog lacks):`)
    for (const h of unmatchedHashes.slice(0, 20)) console.log(`    ${h}`)
  }

  if (multiRowHashes.length > 0) {
    console.log(
      `\n*** hash -> N tidelog rows (N>1) — REVIEW THESE before committing *** (${multiRowHashes.length} hashes)`,
    )
    for (const h of multiRowHashes) {
      const rows = hashToRows.get(h) ?? []
      console.log(`  ${h}  -> ${rows.length} rows:`)
      for (const r of rows) {
        console.log(`      (wallet=${r.walletAddress}, direction=${r.direction}, asset=${r.asset})`)
      }
    }
  } else {
    console.log(`\nNo multi-row (N>1) hash cases.`)
  }

  console.log(`\nqb_post rows ${WOULD}created: ${qbPostsCreated}`)
  if (commit) console.log(`qb_post rows reused:       ${qbPostsReused}`)
  console.log(`tx_qb_state rows ${WOULD}linked: ${stateLinked}`)
  if (commit) {
    console.log(`tx_qb_state skipped (post_id already set): ${stateSkippedAlreadyLinked}`)
  }
  console.log(`─────────────────────────────────────────────────\n`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
