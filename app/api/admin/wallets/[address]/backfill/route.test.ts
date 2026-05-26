import { test, expect, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, transaction } from '@/lib/db/schema'
import { POST } from './route'

const ADMIN_HEADERS = {
  'x-user-id': 'dev-user',
  'x-user-email': 'admin@orca.so',
  'x-user-role': 'admin',
  'x-user-departments': '',
}

const SOL_ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const ETH_ADDR = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

afterEach(async () => {
  await db.delete(transaction).where(eq(transaction.walletAddress, SOL_ADDR)).catch(() => {})
  await db.delete(wallet).where(eq(wallet.address, SOL_ADDR)).catch(() => {})
  await db.delete(wallet).where(eq(wallet.address, ETH_ADDR)).catch(() => {})
})

test('rejects unknown wallet with 404', async () => {
  const req = new Request('http://localhost/api/admin/wallets/UNKNOWN/backfill', { method: 'POST', headers: ADMIN_HEADERS })
  const res = await POST(req, { params: Promise.resolve({ address: 'UNKNOWN' }) })
  expect(res.status).toBe(404)
})

test('rejects ETH wallet with 400', async () => {
  await db.insert(wallet).values({ address: ETH_ADDR, label: 'eth', chain: 'ETH', entityId: 'opco' })
  const req = new Request('http://localhost/api/admin/wallets/x/backfill', { method: 'POST', headers: ADMIN_HEADERS })
  const res = await POST(req, { params: Promise.resolve({ address: ETH_ADDR }) })
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body.code).toBe('admin.backfill_not_supported_for_chain')
})

test('POST rejects type=external', async () => {
  await db.insert(wallet).values({
    address: SOL_ADDR, label: 'External CP', chain: 'SOL', entityId: 'opco',
    type: 'external', hiddenFromFinance: false, needsBackfill: false,
  })
  const req = new Request(`http://localhost/api/admin/wallets/${SOL_ADDR}/backfill`, {
    method: 'POST', headers: ADMIN_HEADERS,
  })
  const res = await POST(req as any, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body.code).toMatch(/external/)
})

test('POST rejects hiddenFromFinance=true', async () => {
  await db.insert(wallet).values({
    address: SOL_ADDR, label: 'Hidden', chain: 'SOL', entityId: 'opco',
    type: 'internal', hiddenFromFinance: true, needsBackfill: false,
  })
  const req = new Request(`http://localhost/api/admin/wallets/${SOL_ADDR}/backfill`, {
    method: 'POST', headers: ADMIN_HEADERS,
  })
  const res = await POST(req as any, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(400)
})

test('POST on success clears needs_backfill and stamps last_full_backfill_at', async () => {
  await db.insert(wallet).values({
    address: SOL_ADDR, label: 'Internal', chain: 'SOL', entityId: 'opco',
    type: 'internal', hiddenFromFinance: false, needsBackfill: true,
  })
  const req = new Request(`http://localhost/api/admin/wallets/${SOL_ADDR}/backfill`, {
    method: 'POST', headers: ADMIN_HEADERS,
  })
  const res = await POST(req as any, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(200)
  const [row] = await db.select().from(wallet).where(eq(wallet.address, SOL_ADDR))
  expect(row?.needsBackfill).toBe(false)
  expect(row?.lastFullBackfillAt).not.toBeNull()
})

test('non-admin returns 403', async () => {
  await db.insert(wallet).values({ address: SOL_ADDR, label: 'x', chain: 'SOL', entityId: 'opco' })
  const VIEWER = { ...ADMIN_HEADERS, 'x-user-role': 'budget_viewer', 'x-user-departments': 'General' }
  const req = new Request('http://localhost/api/admin/wallets/x/backfill', { method: 'POST', headers: VIEWER })
  const res = await POST(req, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(403)
})
