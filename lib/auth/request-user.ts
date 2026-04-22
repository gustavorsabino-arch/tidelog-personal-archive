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

/**
 * Resolve a request's CF JWT email claim into a full user record.
 * Looks up the account row (for multi-email support via account linking) OR
 * falls back to direct user.email match. Returns null if the email is unknown.
 */
export async function loadUserByEmail(email: string): Promise<RequestUser | null> {
  const lower = email.toLowerCase()

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

  return {
    id: row.id,
    email: row.email,
    role: (row.role as Role | null) ?? null,
    departments: depts.map(d => d.department),
    banned: row.banned,
  }
}
