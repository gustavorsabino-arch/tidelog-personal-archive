import { lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbConnection } from '@/lib/db/schema'
import { refreshQboConnection } from '@/lib/qb/client'
import { isQboEntity, type QboEntity } from '@/lib/qb/config'

/**
 * Cron: refresh any QuickBooks access tokens that expire within the next hour.
 */
export async function refreshQbTokensJob() {
  const threshold = new Date(Date.now() + 60 * 60 * 1000)
  const rows = await db.select().from(qbConnection).where(lt(qbConnection.expiresAt, threshold))
  const results: Record<string, unknown> = {}
  let refreshed = 0
  let failed = 0

  for (const row of rows) {
    const cap = row.entityId.charAt(0).toUpperCase() + row.entityId.slice(1).toLowerCase()
    if (!isQboEntity(cap)) {
      results[row.realmId] = { ok: false, error: `unknown entity id: ${row.entityId}` }
      failed++
      continue
    }
    try {
      await refreshQboConnection(cap as QboEntity)
      results[row.realmId] = { ok: true }
      refreshed++
    } catch (err) {
      results[row.realmId] = { ok: false, error: (err as Error).message }
      failed++
    }
  }

  return { ok: true, considered: rows.length, refreshed, failed, results }
}
