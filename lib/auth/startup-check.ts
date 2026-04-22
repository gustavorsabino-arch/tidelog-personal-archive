/**
 * SKIP_AUTH values:
 *   'none' (or empty)  — disabled; use real CF JWT flow
 *   'admin'            — synthetic admin user
 *   <csv of depts>     — synthetic budget_viewer with those departments
 *                         e.g. SKIP_AUTH='Finance,Legal'
 *
 * Fail-closed: refuses any value other than 'none' outside NODE_ENV=development.
 */
export type SkipAuthMode =
  | { kind: 'none' }
  | { kind: 'admin' }
  | { kind: 'viewer'; departments: string[] }

const RESERVED = new Set(['none', 'admin'])

export function parseSkipAuth(raw: string | undefined): SkipAuthMode {
  const v = (raw ?? '').trim()
  if (v === '' || v === 'none') return { kind: 'none' }
  if (v === 'admin') return { kind: 'admin' }
  const departments = v.split(',').map(s => s.trim()).filter(Boolean)
  if (departments.length === 0) {
    throw new Error(
      `invalid SKIP_AUTH value: ${JSON.stringify(raw)}. ` +
      `Expected 'none' | 'admin' | a comma-separated list of department names (e.g. 'Finance,Legal').`,
    )
  }
  // Guard against someone writing SKIP_AUTH='admin,Finance' expecting a hybrid role.
  if (departments.some((d) => RESERVED.has(d.toLowerCase()))) {
    throw new Error(
      `invalid SKIP_AUTH value: ${JSON.stringify(raw)}. ` +
      `Reserved words 'none'/'admin' cannot appear inside a department list.`,
    )
  }
  return { kind: 'viewer', departments }
}

export type AuthMode = 'cf-access' | 'better-auth'

export function parseAuthMode(raw: string | undefined): AuthMode {
  const v = (raw ?? '').trim()
  if (v === '' || v === 'cf-access') return 'cf-access'
  if (v === 'better-auth') return 'better-auth'
  throw new Error(
    `invalid AUTH_MODE value: ${JSON.stringify(raw)}. Expected 'cf-access' | 'better-auth'.`,
  )
}

/**
 * Fail-closed guard: refuses auth bypass outside development AND refuses to boot
 * when AUTH_MODE's required env vars are missing.
 */
export function assertSafeStartup(env: {
  NODE_ENV?: string
  SKIP_AUTH?: string
  AUTH_MODE?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  NEXT_PUBLIC_APP_URL?: string
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
}): void {
  const skip = parseSkipAuth(env.SKIP_AUTH)
  if (skip.kind !== 'none' && env.NODE_ENV !== 'development') {
    throw new Error(
      `SKIP_AUTH=${env.SKIP_AUTH} is only allowed when NODE_ENV=development. Refusing to boot.`,
    )
  }

  const mode = parseAuthMode(env.AUTH_MODE)

  // When dev bypass is active, downstream auth env vars are unused — skip.
  if (skip.kind !== 'none') return

  if (mode === 'better-auth') {
    const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXT_PUBLIC_APP_URL'] as const
    for (const key of required) {
      if (!env[key]) throw new Error(`AUTH_MODE=better-auth requires ${key}. Refusing to boot.`)
    }
  } else {
    // cf-access
    const required = ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'] as const
    for (const key of required) {
      if (!env[key]) throw new Error(`AUTH_MODE=cf-access requires ${key}. Refusing to boot.`)
    }
  }
}

export function readSkipAuthMode(): SkipAuthMode {
  assertSafeStartup(process.env)
  return parseSkipAuth(process.env.SKIP_AUTH)
}

export function readAuthMode(): AuthMode {
  assertSafeStartup(process.env)
  return parseAuthMode(process.env.AUTH_MODE)
}
