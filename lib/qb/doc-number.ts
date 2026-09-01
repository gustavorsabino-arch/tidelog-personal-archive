import { like } from 'drizzle-orm'
import { fetchQboJson } from './client'
import { getQboRealmId, type QboEntity } from './config'
import { db } from '@/lib/db'
import { qbPost } from '@/lib/db/schema'

const MONTH_ABBREV = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

// Single source of truth for DocNumber formats. To change the convention, edit
// these two functions and parseDocSequence; nothing else should hardcode the
// `TL-` / `BULK-` strings.
export function formatIndividualDocNumber(blockTime: Date, seq: number): string {
  const mon = MONTH_ABBREV[blockTime.getUTCMonth()]
  const seqStr = seq < 100 ? seq.toString().padStart(2, '0') : seq.toString()
  return `TL-${mon}-JE${seqStr}`
}

export function formatBulkDocNumber(token: string, blockTime: Date): string {
  const yyyy = blockTime.getUTCFullYear()
  const mm = String(blockTime.getUTCMonth() + 1).padStart(2, '0')
  return `BULK-${token}-${yyyy}-${mm}`
}

export function parseDocSequence(docNumber: string, prefix: string): number | null {
  const marker = `${prefix}-JE`
  if (!docNumber.startsWith(marker)) return null
  const tail = docNumber.slice(marker.length)
  const n = Number.parseInt(tail, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Returns the next free `TL-{Mon}-JE##` sequence for the given month.
//
// The previous implementation asked QBO for `DocNumber LIKE ... ORDER BY
// DocNumber DESC` — a full JournalEntry scan on QBO's side that started
// timing out (>60s) as the books grew, blocking every post. Now:
//   1. the local qb_post table supplies the max sequence tidelog itself has
//      ever posted for this month prefix (instant, covers prior years), and
//   2. a TxnDate-scoped QBO query (fast, indexed; no LIKE, no ORDER BY)
//      catches JEs created manually in QB for the SAME month.
// If the QBO query still fails, the local max alone decides — worst case a
// number that exists only in QB gets reused, and the post-POST duplicate
// scan flags it for manual review.
//
// IMPORTANT: callers must run this inside a Postgres advisory lock keyed by
// (entity, year-month) to prevent two concurrent posts from picking the same
// sequence. See `lib/qb/post-batch.ts` for the locking wrapper.
export async function getNextIndividualSequence(
  entity: QboEntity,
  blockTime: Date,
): Promise<number> {
  const mon = MONTH_ABBREV[blockTime.getUTCMonth()]
  const prefix = `TL-${mon}`
  let maxSeq = 0

  const local = await db
    .select({ docNumber: qbPost.docNumber })
    .from(qbPost)
    .where(like(qbPost.docNumber, `${prefix}-JE%`))
  for (const r of local) {
    const n = parseDocSequence(r.docNumber, prefix)
    if (n && n > maxSeq) maxSeq = n
  }

  try {
    const yyyy = blockTime.getUTCFullYear()
    const m = blockTime.getUTCMonth()
    const monthStart = `${yyyy}-${String(m + 1).padStart(2, '0')}-01`
    const monthEnd = new Date(Date.UTC(yyyy, m + 1, 0)).toISOString().slice(0, 10)
    const realmId = getQboRealmId(entity)
    const query = `SELECT DocNumber FROM JournalEntry WHERE TxnDate >= '${monthStart}' AND TxnDate <= '${monthEnd}' MAXRESULTS 1000`
    const res = await fetchQboJson<{
      QueryResponse?: { JournalEntry?: Array<{ DocNumber?: string }> }
    }>(
      entity,
      `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`,
    )
    for (const je of res.QueryResponse?.JournalEntry ?? []) {
      const n = je.DocNumber ? parseDocSequence(je.DocNumber, prefix) : null
      if (n && n > maxSeq) maxSeq = n
    }
  } catch (err) {
    console.warn(
      `[doc-number] QBO month query failed — sequencing from local max ${maxSeq}: ${(err as Error).message}`,
    )
  }

  return maxSeq + 1
}
