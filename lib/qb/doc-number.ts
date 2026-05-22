import { fetchQboJson } from './client'
import { getQboRealmId, type QboEntity } from './config'

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

// Queries QB for the highest existing DocNumber matching `TL-{Mon}-JE%` for the
// given month, and returns max + 1 (or 1 if none exist).
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
  const realmId = getQboRealmId(entity)
  const query = `SELECT DocNumber FROM JournalEntry WHERE DocNumber LIKE '${prefix}-JE%' ORDER BY DocNumber DESC MAXRESULTS 1`
  const res = await fetchQboJson<{
    QueryResponse?: { JournalEntry?: Array<{ DocNumber: string }> }
  }>(
    entity,
    `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`,
  )
  const top = res.QueryResponse?.JournalEntry?.[0]?.DocNumber
  if (!top) return 1
  const n = parseDocSequence(top, prefix)
  return (n ?? 0) + 1
}
