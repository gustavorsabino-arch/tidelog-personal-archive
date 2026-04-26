import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { user, account } from '@/lib/db/schema/auth'
import { userDepartment } from '@/lib/db/schema/authz'
import type { Role } from './permissions'

export type RequestUser = {
  id: string
  email: string
  role: Role | null
  departments: string[]
  banned: boolean
}

// Module-level cache for the 4-query email→user lookup that runs in proxy.ts
// on every request. Vercel keeps function instances warm for several minutes,
// so this cache persists across invocations on the same instance.
//
// 60s TTL is the staleness window for ban / role / department changes — the
// invalidate* helpers below provide explicit invalidation for admin endpoints
// that mutate users so the window only matters for cross-instance changes.
const CACHE_TTL_MS = 60_000
type Entry = { user: RequestUser; expiresAt: number }
const cache = new Map<string, Entry>()

/**
 * Resolve a request's email identity into a full user record.
 * Looks up the account row (for multi-email support via account linking) OR
 * falls back to direct user.email match. Returns null if the email is unknown.
 *
 * Successful lookups are cached for 60s. Unknown emails are not negative-cached:
 * such requests get redirected to /no-access on the first hit so the path is not
 * hot, and skipping negative caching keeps invalidation simple.
 */
export async function loadUserByEmail(email: string): Promise<RequestUser | null> {
  const lower = email.toLowerCase()

  const hit = cache.get(lower)
  if (hit && hit.expiresAt > Date.now()) return hit.user

  // Primary lookup: account table (where linked emails live)
  const [acc] = await db.select({ userId: account.userId })
    .from(account)
    .where(eq(account.email, lower))
    .limit(1)

  let userId: string | null = acc?.userId ?? null

  // Fallback: direct user.email match (for users never linked via account provider)
  if (!userId) {
    const [u] = await db.select({ id: user.id })
      .from(user)
      .where(eq(user.email, lower))
      .limit(1)
    userId = u?.id ?? null
  }

  if (!userId) return null

  const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  if (!row) return null

  const depts = await db.select({ department: userDepartment.department })
    .from(userDepartment)
    .where(eq(userDepartment.userId, userId))

  const result: RequestUser = {
    id: row.id,
    email: row.email,
    role: (row.role as Role | null) ?? null,
    departments: depts.map(d => d.department),
    banned: row.banned,
  }

  cache.set(lower, { user: result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}

/** Drop a single email from the cache. Use when you know the exact email
 *  affected (e.g. linkEmail / unlinkEmail). */
export function invalidateUserCacheByEmail(email: string): void {
  cache.delete(email.toLowerCase())
}

/** Drop every cache entry for a given userId. Use after mutations that affect
 *  a user as a whole (role, departments, banned, delete) since the user may be
 *  reachable under several linked emails. */
export function invalidateUserCacheByUserId(userId: string): void {
  for (const [email, entry] of cache) {
    if (entry.user.id === userId) cache.delete(email)
  }
}

/** Test-only: wipe the cache between cases. */
export function __clearUserCacheForTests(): void {
  cache.clear()
}
