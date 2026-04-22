import { and, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbReportCache, price } from '@/lib/db/schema'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000

/**
 * Cron: delete stale cache rows to keep table size bounded.
 * - qb_report_cache rows older than 90 days
 * - historical price rows older than 2 years
 */
export async function pruneCacheJob() {
  const qbCutoff = new Date(Date.now() - NINETY_DAYS_MS)
  const qbDeleted = await db.delete(qbReportCache)
    .where(lt(qbReportCache.fetchedAt, qbCutoff))
    .returning({ id: qbReportCache.id })

  const priceCutoff = new Date(Date.now() - TWO_YEARS_MS)
  const priceDeleted = await db.delete(price)
    .where(and(eq(price.source, 'historical'), lt(price.timestamp, priceCutoff)))
    .returning({ token: price.token, timestamp: price.timestamp })

  return {
    ok: true,
    qbReportsPruned: qbDeleted.length,
    pricesPruned: priceDeleted.length,
  }
}
