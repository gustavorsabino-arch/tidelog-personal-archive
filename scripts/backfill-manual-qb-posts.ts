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
// Solana signatures are 86-88 base58 chars. We harvest base58 RUNS with a 40+
// floor (for diagnostic visibility), then probe an indexed Set of real tidelog
// hashes. Because base58 overlaps ordinary letters, adjacent words can glue
// onto a hash (e.g. "Execution<88-char hash>" -> one ~97-char run), so an
// exact lookup of the raw run misses. We instead (a) fast-path direct-check
// runs of length 86-88, and (b) slide 86/87/88-char windows across longer (or
// fast-path-missed) runs to recover the embedded hash. Runs < 86 chars cannot
// contain a full signature and are skipped (no prefix/partial matching — that
// would risk false positives).
const BASE58_TOKEN = /[1-9A-HJ-NP-Za-km-z]{40,}/g
// Valid Solana signature lengths (base58-encoded 64-byte sigs).
const SIG_LENGTHS = [86, 87, 88] as const
const SIG_MIN_LEN = 86

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

// Resolve harvested base58 runs against the indexed Set of real tidelog tx
// hashes for this entity. Returns the distinct hashes that matched, plus the
// runs from which NO window matched (for the "unmatched" diagnostic), plus a
// count of sub-86 fragments that were skipped outright.
//
// Per run:
//   - run.length < 86            -> too short to hold a full sig; skip (fragment)
//   - run.length in {86,87,88}   -> FAST PATH: direct hashSet.has(run) hit ⇒ done
//   - otherwise (len > 88, or fast-path missed) -> SLIDE: try every 86/87/88
//     window; each window in the set is a recovered hash (handles glued runs).
function resolveMatchedHashes(
  runs: string[],
  hashSet: Set<string>,
): { matched: Set<string>; unmatchedRuns: string[]; shortFragments: number } {
  const matched = new Set<string>()
  const unmatchedRuns: string[] = []
  let shortFragments = 0

  for (const run of runs) {
    if (run.length < SIG_MIN_LEN) {
      shortFragments += 1
      continue
    }

    // Fast path: a clean run that IS exactly a hash (the common case).
    if (run.length <= 88 && hashSet.has(run)) {
      matched.add(run)
      continue
    }

    // Slide path: recover an embedded hash from a glued/longer run. Also the
    // fallback when a 86-88 run didn't directly hit (e.g. trailing glue chars).
    let hitThisRun = false
    for (const w of SIG_LENGTHS) {
      if (run.length < w) continue
      const last = run.length - w
      for (let i = 0; i <= last; i += 1) {
        const window = run.slice(i, i + w)
        if (hashSet.has(window)) {
          matched.add(window)
          hitThisRun = true
        }
      }
    }

    // A >=86 run that yielded no in-set window is genuinely unmatched
    // (other-entity sig, ETH-style hex token, or a tx tidelog lacks).
    if (!hitThisRun) unmatchedRuns.push(run)
  }

  return { matched, unmatchedRuns, shortFragments }
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

  // 2. Build the O(1) lookup index: the Set of every distinct tidelog tx hash
  //    for this entity. Built ONCE; its size is irrelevant to per-probe cost.
  //    Tens of thousands of rows is fine — this is an offline one-time script.
  console.log('Loading tidelog tx-hash index for entity…')
  const hashRows = await db
    .selectDistinct({ txHash: transaction.txHash })
    .from(transaction)
    .where(eq(transaction.entityId, dbEntity))
  const entityHashSet = new Set<string>(hashRows.map((r) => r.txHash))
  console.log(`  indexed ${entityHashSet.size} distinct tidelog tx hashes`)

  // 3. Harvest base58 runs per JE, then resolve each JE to the set of real
  //    tidelog hashes it references via fast-path + windowed probe.
  let hashlessJeCount = 0 // JE yielded no base58 run >= 40 chars at all
  let jesWithHash = 0 // JE yielded >= 1 matched tidelog hash
  let shortFragmentsSkipped = 0 // sub-86 base58 runs skipped (diagnostics)
  const allMatchedHashes = new Set<string>() // distinct matched hashes overall
  // Diagnostic: >=86 runs (or longer runs) from which NO window matched the set.
  const unmatchedRunSet = new Set<string>()
  // JE id -> distinct matched tidelog hashes (drives the per-JE upsert step).
  const jeHashes = new Map<string, string[]>()

  for (const je of jes) {
    const runs = harvestHashes(je)
    if (runs.length === 0) {
      hashlessJeCount += 1
      continue
    }
    const { matched, unmatchedRuns, shortFragments } = resolveMatchedHashes(
      runs,
      entityHashSet,
    )
    shortFragmentsSkipped += shortFragments
    for (const run of unmatchedRuns) unmatchedRunSet.add(run)

    if (matched.size === 0) continue
    jesWithHash += 1
    jeHashes.set(je.Id ?? '', [...matched])
    for (const h of matched) allMatchedHashes.add(h)
  }

  // 4. Pull tidelog row detail for the matched hashes (we already know they
  //    exist for this entity; we need wallet/direction/asset to link each leg).
  const matchedHashList = [...allMatchedHashes]
  const matchedRows: MatchedRow[] = []
  // Batch the IN() to keep the query reasonable.
  const CHUNK = 500
  for (let i = 0; i < matchedHashList.length; i += CHUNK) {
    const chunk = matchedHashList.slice(i, i + CHUNK)
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

  const matchedHashes = matchedHashList.filter((h) => hashToRows.has(h))
  const unmatchedHashes = [...unmatchedRunSet]
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
  console.log(`\nJEs scanned:              ${jes.length}`)
  console.log(`JEs with >= 1 matched hash: ${jesWithHash}`)
  console.log(`JEs with no base58 run:   ${hashlessJeCount}`)
  console.log(`\nTidelog hashes indexed:   ${entityHashSet.size}`)
  console.log(`Distinct matched hashes:  ${matchedHashes.length}`)
  console.log(`Short base58 runs skipped (<86 chars): ${shortFragmentsSkipped}`)
  console.log(`Unmatched >=86 base58 runs:            ${unmatchedHashes.length}`)

  if (unmatchedHashes.length > 0) {
    console.log(
      `\nFirst ${Math.min(20, unmatchedHashes.length)} unmatched runs ` +
        `(>=86 base58 with no in-set window — other entities, ETH-hex tokens, or txs tidelog lacks):`,
    )
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
