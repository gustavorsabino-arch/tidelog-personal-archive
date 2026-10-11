import { and, eq, like } from 'drizzle-orm'
import { type QboEntity } from './config'

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

export function formatBulkDocNumber(token: string, blockTime: Date, sequence?: number): string {
  const yyyy = blockTime.getUTCFullYear()
  const mm = String(blockTime.getUTCMonth() + 1).padStart(2, '0')
  const prefix = `BULK-${token}-${yyyy}-${mm}`
  return sequence == null ? prefix : `${prefix}-${String(sequence).padStart(2, '0')}`
}

// Call under the entity/month posting advisory lock. Existing legacy bulk
// numbers have no suffix; each new JE gets its own DocNumber and Request-Id.
export async function getNextBulkSequence(entity: QboEntity, token: string, blockTime: Date): Promise<number> {
  const prefix = formatBulkDocNumber(token, blockTime)
  const [{ db }, { qbPost }, { toDbEntity }] = await Promise.all([
    import('@/lib/db'), import('@/lib/db/schema'), import('@/lib/entity'),
  ])
  const rows = await db.select({ docNumber: qbPost.docNumber }).from(qbPost)
    .where(and(eq(qbPost.entityId, toDbEntity(entity)), like(qbPost.docNumber, `${prefix}-%`)))
  let max = 0
  for (const row of rows) {
    const suffix = row.docNumber.slice(prefix.length + 1)
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix))
  }
  return max + 1
}

export function parseDocSequence(docNumber: string, prefix: string): number | null {
  const marker = `${prefix}-JE`
  if (!docNumber.startsWith(marker)) return null
  const tail = docNumber.slice(marker.length)
  const n = Number.parseInt(tail, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Returns the next free `TL-{Mon}-JE##` sequence for the given month, from the
// LOCAL qb_post table only — instant, zero QuickBooks calls.
//
// History: the original implementation queried QBO (`DocNumber LIKE ... ORDER
// BY DocNumber DESC`), a full JournalEntry scan that began timing out as the
// books grew. Replacing it with a TxnDate-scoped QBO query still put a heavy
// (up-to-1000-row) read on QBO right before every POST, which contributed to
// QBO 504s. The local qb_post table already records every JE tidelog posts, so
// it is the authoritative source for tidelog's own sequence. A JE created
// MANUALLY in QB with a TL- number (rare) could collide; the post-POST
// duplicate scan flags that for manual review.
//
// IMPORTANT: callers must run this inside a Postgres advisory lock keyed by
// (entity, year-month) to prevent two concurrent posts from picking the same
// sequence. See `lib/qb/post-batch.ts` for the locking wrapper.
export async function getNextIndividualSequence(
  _entity: QboEntity,
  blockTime: Date,
): Promise<number> {
  const mon = MONTH_ABBREV[blockTime.getUTCMonth()]
  const prefix = `TL-${mon}`
  let maxSeq = 0

  // Lazy imports: '@/lib/db' (and the schema barrel, which pulls it in)
  // validate DB_MODE at module load, so importing them at the top would break
  // every unit test of the pure formatters in this file.
  const [{ db }, { qbPost }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
  ])
  const local = await db
    .select({ docNumber: qbPost.docNumber })
    .from(qbPost)
    .where(like(qbPost.docNumber, `${prefix}-JE%`))
  for (const r of local) {
    const n = parseDocSequence(r.docNumber, prefix)
    if (n && n > maxSeq) maxSeq = n
  }

  return maxSeq + 1
}

