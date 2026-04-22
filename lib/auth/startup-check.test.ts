import { test, expect } from 'bun:test'
import { assertSafeStartup, parseSkipAuth, parseAuthMode } from './startup-check'

// ─── assertSafeStartup ──────────────────────────────────────────────

// Supply minimal CF vars for SKIP_AUTH=none tests since the guard now also checks AUTH_MODE vars.
const cfEnv = { CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' }

test('SKIP_AUTH=none allowed in any env', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'production', SKIP_AUTH: 'none', ...cfEnv })).not.toThrow()
  expect(() => assertSafeStartup({ NODE_ENV: 'development', SKIP_AUTH: 'none', ...cfEnv })).not.toThrow()
  expect(() => assertSafeStartup({ NODE_ENV: 'test', SKIP_AUTH: 'none', ...cfEnv })).not.toThrow()
})

test('SKIP_AUTH unset is equivalent to none', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'production', ...cfEnv })).not.toThrow()
  expect(() => assertSafeStartup({ NODE_ENV: 'development', ...cfEnv })).not.toThrow()
})

test('SKIP_AUTH=admin allowed in dev', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'development', SKIP_AUTH: 'admin' })).not.toThrow()
})

test('SKIP_AUTH=<dept-csv> allowed in dev', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'development', SKIP_AUTH: 'Finance,Legal' })).not.toThrow()
  expect(() => assertSafeStartup({ NODE_ENV: 'development', SKIP_AUTH: 'Ops' })).not.toThrow()
})

test('SKIP_AUTH=admin in production throws', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'production', SKIP_AUTH: 'admin' }))
    .toThrow(/SKIP_AUTH/)
})

test('SKIP_AUTH=<dept-csv> in production throws', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'production', SKIP_AUTH: 'Finance,Legal' }))
    .toThrow(/SKIP_AUTH/)
})

test('SKIP_AUTH=admin in test env throws (fail-closed outside dev)', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'test', SKIP_AUTH: 'admin' }))
    .toThrow(/SKIP_AUTH/)
})

test('only-commas/whitespace SKIP_AUTH throws', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'development', SKIP_AUTH: ',,,' }))
    .toThrow(/invalid SKIP_AUTH/)
  expect(() => assertSafeStartup({ NODE_ENV: 'development', SKIP_AUTH: '   ', ...cfEnv }))
    .not.toThrow() // whitespace-only is trimmed to empty == none
})

test('SKIP_AUTH with reserved word inside CSV throws', () => {
  expect(() => assertSafeStartup({ NODE_ENV: 'development', SKIP_AUTH: 'admin,Finance' }))
    .toThrow(/invalid SKIP_AUTH/)
  expect(() => assertSafeStartup({ NODE_ENV: 'development', SKIP_AUTH: 'Finance,none' }))
    .toThrow(/invalid SKIP_AUTH/)
})

// ─── parseSkipAuth (the actual parser) ───────────────────────────────

test('parseSkipAuth: none variants', () => {
  expect(parseSkipAuth(undefined)).toEqual({ kind: 'none' })
  expect(parseSkipAuth('')).toEqual({ kind: 'none' })
  expect(parseSkipAuth('  ')).toEqual({ kind: 'none' })
  expect(parseSkipAuth('none')).toEqual({ kind: 'none' })
})

test('parseSkipAuth: admin', () => {
  expect(parseSkipAuth('admin')).toEqual({ kind: 'admin' })
})

test('parseSkipAuth: single department', () => {
  expect(parseSkipAuth('Finance')).toEqual({ kind: 'viewer', departments: ['Finance'] })
})

test('parseSkipAuth: multiple departments, trimmed', () => {
  expect(parseSkipAuth('Finance, Legal ,Ops')).toEqual({
    kind: 'viewer',
    departments: ['Finance', 'Legal', 'Ops'],
  })
})

test('parseSkipAuth: blank entries are filtered', () => {
  expect(parseSkipAuth('Finance,,Legal')).toEqual({
    kind: 'viewer',
    departments: ['Finance', 'Legal'],
  })
})

test('parseSkipAuth: preserves casing of department names', () => {
  expect(parseSkipAuth('finance,LEGAL,Business Development')).toEqual({
    kind: 'viewer',
    departments: ['finance', 'LEGAL', 'Business Development'],
  })
})

// ─── parseAuthMode ───────────────────────────────────────────────────

test('parseAuthMode: undefined defaults to cf-access', () => {
  expect(parseAuthMode(undefined)).toBe('cf-access')
})

test('parseAuthMode: empty string defaults to cf-access', () => {
  expect(parseAuthMode('')).toBe('cf-access')
  expect(parseAuthMode('   ')).toBe('cf-access')
})

test('parseAuthMode: cf-access', () => {
  expect(parseAuthMode('cf-access')).toBe('cf-access')
})

test('parseAuthMode: better-auth', () => {
  expect(parseAuthMode('better-auth')).toBe('better-auth')
})

test('parseAuthMode: unknown value throws', () => {
  expect(() => parseAuthMode('oauth')).toThrow(/invalid AUTH_MODE/)
  expect(() => parseAuthMode('none')).toThrow(/invalid AUTH_MODE/)
})

// ─── assertSafeStartup × AUTH_MODE ───────────────────────────────────

test('AUTH_MODE=better-auth requires Google creds + NEXT_PUBLIC_APP_URL', () => {
  const base = {
    NODE_ENV: 'production',
    SKIP_AUTH: 'none',
    AUTH_MODE: 'better-auth',
    NEXT_PUBLIC_APP_URL: 'https://tidelog.vercel.app',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
  }
  expect(() => assertSafeStartup(base)).not.toThrow()

  expect(() => assertSafeStartup({ ...base, GOOGLE_CLIENT_ID: undefined }))
    .toThrow(/GOOGLE_CLIENT_ID/)
  expect(() => assertSafeStartup({ ...base, GOOGLE_CLIENT_SECRET: undefined }))
    .toThrow(/GOOGLE_CLIENT_SECRET/)
  expect(() => assertSafeStartup({ ...base, NEXT_PUBLIC_APP_URL: undefined }))
    .toThrow(/NEXT_PUBLIC_APP_URL/)
})

test('AUTH_MODE=cf-access in prod requires CF vars when SKIP_AUTH=none', () => {
  const base = {
    NODE_ENV: 'production',
    SKIP_AUTH: 'none',
    AUTH_MODE: 'cf-access',
    CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    CF_ACCESS_AUD: 'aud-tag',
  }
  expect(() => assertSafeStartup(base)).not.toThrow()

  expect(() => assertSafeStartup({ ...base, CF_ACCESS_TEAM_DOMAIN: undefined }))
    .toThrow(/CF_ACCESS_TEAM_DOMAIN/)
  expect(() => assertSafeStartup({ ...base, CF_ACCESS_AUD: undefined }))
    .toThrow(/CF_ACCESS_AUD/)
})

test('AUTH_MODE=cf-access in dev with SKIP_AUTH=admin does not require CF vars', () => {
  expect(() => assertSafeStartup({
    NODE_ENV: 'development',
    SKIP_AUTH: 'admin',
    AUTH_MODE: 'cf-access',
  })).not.toThrow()
})

test('invalid AUTH_MODE throws via assertSafeStartup', () => {
  expect(() => assertSafeStartup({
    NODE_ENV: 'development',
    SKIP_AUTH: 'none',
    AUTH_MODE: 'nope',
  })).toThrow(/invalid AUTH_MODE/)
})
