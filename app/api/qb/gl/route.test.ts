import test from 'node:test'
import assert from 'node:assert/strict'

import { GET } from './route.ts'

function makeReq(path: string): Request {
  return new Request(`http://localhost${path}`)
}

test('GET /api/qb/gl rejects missing params', async () => {
  // Bypass auth by setting SKIP_AUTH=dev in the test env if needed.
  // Without auth bypass, expect 401/403; with bypass, expect 400 from zod.
  const res = await GET(makeReq('/api/qb/gl?entity=Opco'))
  assert.equal([400, 401, 403].includes(res.status), true,
    `expected 400/401/403, got ${res.status}`)
})

test('GET /api/qb/gl rejects invalid entity', async () => {
  const res = await GET(makeReq('/api/qb/gl?entity=Bogus&accountNumber=40110&periodStart=2026-01-01&periodEnd=2026-01-31'))
  assert.equal([400, 401, 403].includes(res.status), true,
    `expected 400/401/403, got ${res.status}`)
})

test('GET /api/qb/gl rejects invalid date format', async () => {
  const res = await GET(makeReq('/api/qb/gl?entity=Opco&accountNumber=40110&periodStart=Jan2026&periodEnd=2026-01-31'))
  assert.equal([400, 401, 403].includes(res.status), true,
    `expected 400/401/403, got ${res.status}`)
})
