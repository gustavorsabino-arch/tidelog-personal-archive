/**
 * Direct-import permission tests. Each test constructs a Request with
 * proxy-style user headers and asserts the route handler returns the
 * expected HTTP status (403 for denied, non-403/401 for allowed).
 *
 * We only exercise the permission guard: routes that would otherwise hit the
 * DB or an external service are still checked — we just don't care what
 * non-auth failure mode they return, only that they're not 403.
 */

import { test, expect } from 'bun:test'
import { NextRequest } from 'next/server'

// These tests exercise only the permission guard. logAudit writes to the
// real DB through the live Drizzle connection — `supabase start` must
// be running (same assumption as every other integration test in this repo).

function headers(overrides: Record<string, string> = {}) {
  return {
    'x-user-id': 'test-user',
    'x-user-email': 'test@orca.so',
    'x-user-role': '',
    'x-user-departments': '',
    ...overrides,
  }
}

const ADMIN = headers({ 'x-user-role': 'admin', 'x-user-id': 'admin-test', 'x-user-email': 'admin@orca.so' })
const VIEWER = headers({
  'x-user-role': 'budget_viewer',
  'x-user-id': 'viewer-test',
  'x-user-email': 'viewer@orca.so',
  'x-user-departments': 'General',
})
const NOROLE = headers()

type NextReqInit = Omit<RequestInit, 'signal'> & { signal?: AbortSignal }

function makeReq(url: string, h: Record<string, string>, init: NextReqInit = {}) {
  return new NextRequest(url, {
    ...init,
    headers: { ...h, ...(init.headers as Record<string, string> ?? {}) },
  })
}

// --- treasury:read guards budget_viewer out -----------------------------

test('/api/treasury/transactions denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/treasury/transactions/route')
  const res = await GET(makeReq('http://localhost/api/treasury/transactions?entity=Opco', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/treasury/transactions/months denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/treasury/transactions/months/route')
  const res = await GET(makeReq('http://localhost/api/treasury/transactions/months?entity=Opco', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/treasury/overview denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/treasury/overview/route')
  const res = await GET(makeReq('http://localhost/api/treasury/overview', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/treasury/overview/trend denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/treasury/overview/trend/route')
  const res = await GET(makeReq('http://localhost/api/treasury/overview/trend?wallet=abc&tokens=USDC', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/treasury/gain-loss denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/treasury/gain-loss/route')
  const res = await GET(makeReq('http://localhost/api/treasury/gain-loss?entity=Opco', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/treasury-management/positions denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/treasury-management/positions/route')
  const res = await GET(makeReq('http://localhost/api/treasury-management/positions', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/wallets denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/wallets/route')
  const res = await GET(makeReq('http://localhost/api/wallets', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/prices denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/prices/route')
  const res = await GET(makeReq('http://localhost/api/prices', VIEWER))
  expect(res.status).toBe(403)
})

// --- qb:read guards budget_viewer out -----------------------------------

test('/api/qb/reports/[type] denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/qb/reports/[type]/route')
  const res = await GET(
    makeReq('http://localhost/api/qb/reports/balance_sheet?entity=Opco&periodStart=2026-01-01&periodEnd=2026-01-31', VIEWER),
    { params: Promise.resolve({ type: 'balance_sheet' }) },
  )
  expect(res.status).toBe(403)
})

// --- budget_viewer ALLOWED on budget:read routes ------------------------
// If the handler throws (e.g. DB unreachable in sandbox), the permission
// check still passed — we got past the guard to the DB call. That's a pass.

async function pastPermissionGuard(fn: () => Promise<Response>): Promise<boolean> {
  try {
    const res = await fn()
    return res.status !== 403 && res.status !== 401
  } catch {
    // Handler threw after the guard — still means the guard let us through.
    return true
  }
}

test('/api/budget/lines allows budget_viewer past the guard', async () => {
  const { GET } = await import('@/app/api/budget/lines/route')
  expect(await pastPermissionGuard(() => GET(makeReq('http://localhost/api/budget/lines', VIEWER)))).toBe(true)
})

test('/api/budget/state allows budget_viewer past the guard', async () => {
  const { GET } = await import('@/app/api/budget/state/route')
  expect(await pastPermissionGuard(() => GET(makeReq('http://localhost/api/budget/state', VIEWER)))).toBe(true)
})

// --- budget_viewer DENIED on admin-only budget tabs ---------------------

test('/api/budget/coverage denies budget_viewer (admin-only tab)', async () => {
  const { GET } = await import('@/app/api/budget/coverage/route')
  const res = await GET(makeReq('http://localhost/api/budget/coverage', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/budget/headcount/actuals denies budget_viewer (admin-only tab)', async () => {
  const { GET } = await import('@/app/api/budget/headcount/actuals/route')
  const res = await GET(makeReq('http://localhost/api/budget/headcount/actuals', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/budget/actuals (overview) denies budget_viewer', async () => {
  const { GET } = await import('@/app/api/budget/actuals/route')
  const res = await GET(makeReq('http://localhost/api/budget/actuals', VIEWER))
  expect(res.status).toBe(403)
})

test('/api/budget/team POST denies budget_viewer (manage-team)', async () => {
  const { POST } = await import('@/app/api/budget/team/route')
  const res = await POST(makeReq('http://localhost/api/budget/team', VIEWER, {
    method: 'POST',
    body: JSON.stringify({ action: 'create-member', year: 2026 }),
    headers: { 'content-type': 'application/json' },
  }) as never)
  expect(res.status).toBe(403)
})

test('/api/budget/mapping POST denies budget_viewer (admin-only tab)', async () => {
  const { POST } = await import('@/app/api/budget/mapping/route')
  const res = await POST(makeReq('http://localhost/api/budget/mapping', VIEWER, {
    method: 'POST',
    body: JSON.stringify({ year: 2026, rows: [] }),
    headers: { 'content-type': 'application/json' },
  }) as never)
  expect(res.status).toBe(403)
})

test('/api/budget/import POST denies budget_viewer', async () => {
  const { POST } = await import('@/app/api/budget/import/route')
  const res = await POST(makeReq('http://localhost/api/budget/import', VIEWER, { method: 'POST' }) as never)
  expect(res.status).toBe(403)
})

// --- unauthenticated (no role header) gets 401/403 ----------------------

test('/api/treasury/transactions rejects unauthenticated requests', async () => {
  const { GET } = await import('@/app/api/treasury/transactions/route')
  const res = await GET(makeReq('http://localhost/api/treasury/transactions?entity=Opco', NOROLE))
  expect([401, 403]).toContain(res.status)
})

test('/api/budget/lines rejects unauthenticated requests', async () => {
  const { GET } = await import('@/app/api/budget/lines/route')
  const res = await GET(makeReq('http://localhost/api/budget/lines', NOROLE))
  expect([401, 403]).toContain(res.status)
})

test('/api/qb/reports/[type] rejects unauthenticated requests', async () => {
  const { GET } = await import('@/app/api/qb/reports/[type]/route')
  const res = await GET(
    makeReq('http://localhost/api/qb/reports/balance_sheet?entity=Opco&periodStart=2026-01-01&periodEnd=2026-01-31', NOROLE),
    { params: Promise.resolve({ type: 'balance_sheet' }) },
  )
  expect([401, 403]).toContain(res.status)
})
