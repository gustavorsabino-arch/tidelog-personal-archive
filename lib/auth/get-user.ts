import { headers } from 'next/headers'
import type { Role } from './permissions'

export type ServerUser = {
  id: string
  email: string
  role: Role
  departments: string[]
}

type HeaderSource = { get: (key: string) => string | null }

async function readHeaders(req?: Request): Promise<HeaderSource> {
  if (req) return req.headers
  return await headers()
}

/**
 * Read the authenticated user from request headers written by the proxy.
 *
 * Prefer passing the Request explicitly from API route handlers — it's
 * cleaner and works in tests without mocking next/headers. The no-arg form
 * falls back to next/headers() for server components.
 */
export async function getServerUser(req?: Request): Promise<ServerUser | null> {
  const h = await readHeaders(req)
  const id = h.get('x-user-id')
  const email = h.get('x-user-email')
  const role = h.get('x-user-role')
  if (!id || !email || !role) return null
  const departments = (h.get('x-user-departments') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { id, email, role: role as Role, departments }
}

export async function requireServerUser(req?: Request): Promise<ServerUser> {
  const user = await getServerUser(req)
  if (!user) throw new Error('no authenticated user on request')
  return user
}
