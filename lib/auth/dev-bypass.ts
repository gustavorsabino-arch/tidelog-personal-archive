import type { SkipAuthMode } from './startup-check'
import type { Role } from './permissions'

export type DevUser = {
  email: string
  role: Role
  departments: string[]
}

/**
 * Build a synthetic user for dev bypass mode.
 * Returns null for 'none' mode — caller should fall through to real CF JWT verification.
 */
export function buildDevUser(mode: SkipAuthMode): DevUser | null {
  if (mode.kind === 'none') return null
  const email = process.env.DEV_USER_EMAIL ?? 'dev@orca.so'

  if (mode.kind === 'admin') {
    return { email, role: 'admin', departments: [] }
  }
  // mode.kind === 'viewer'
  return { email, role: 'budget_viewer', departments: mode.departments }
}
