import { test, expect, beforeEach, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, entity } from '@/lib/db/schema'
import { GET, POST } from './route'

const ADMIN_HEADERS = {
  'x-user-id': 'dev-user',
  'x-user-email': 'admin@orca.so',
  'x-user-role': 'admin',
  'x-user-departments': '',
  'content-type': 'application/json',
}

const VIEWER_HEADERS = { ...ADMIN_HEADERS, 'x-user-role': 'budget_viewer', 'x-user-departments': 'General' }

const SOL_ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const ETH_ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const BTC_ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

const createdAddrs: string[] = []
afterEach(async () => {
  for (const a of createdAddrs.splice(0)) {
    await db.delete(wallet).where(eq(wallet.address, a)).catch(() => {})
  }
})

test('GET returns wallets + entities, requires admin permission', async () => {
  const denied = await GET(new Request('http://localhost/api/admin/wallets', { headers: VIEWER_HEADERS }))
  expect(denied.status).toBe(403)
  const ok = await GET(new Request('http://localhost/api/admin/wallets', { headers: ADMIN_HEADERS }))
  expect(ok.status).toBe(200)
  const body = await ok.json()
  expect(Array.isArray(body.wallets)).toBe(true)
  expect(Array.isArray(body.entities)).toBe(true)
  expect(body.entities.find((e: any) => e.id === 'opco')).toBeDefined()
})

test('POST creates a SOL wallet without backfill', async () => {
  createdAddrs.push(SOL_ADDR)
  const res = await POST(new Request('http://localhost/api/admin/wallets', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ address: SOL_ADDR, label: 'Test SOL', chain: 'SOL', entityId: 'opco', backfill: false }),
  }))
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.wallet.address).toBe(SOL_ADDR)
  expect(body.backfill).toBeUndefined()
  const [row] = await db.select().from(wallet).where(eq(wallet.address, SOL_ADDR))
  expect(row?.label).toBe('Test SOL')
})

test('POST creates an ETH wallet record (no backfill kickoff)', async () => {
  createdAddrs.push(ETH_ADDR.toLowerCase())
  const res = await POST(new Request('http://localhost/api/admin/wallets', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ address: ETH_ADDR, label: 'Test ETH', chain: 'ETH', entityId: 'opco' }),
  }))
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.wallet.address).toBe(ETH_ADDR.toLowerCase())
})

test('POST creates a BTC wallet record', async () => {
  createdAddrs.push(BTC_ADDR)
  const res = await POST(new Request('http://localhost/api/admin/wallets', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ address: BTC_ADDR, label: 'Test BTC', chain: 'BTC', entityId: 'opco' }),
  }))
  expect(res.status).toBe(201)
})

test('POST rejects invalid address for the chosen chain', async () => {
  const res = await POST(new Request('http://localhost/api/admin/wallets', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ address: ETH_ADDR, label: 'Bad', chain: 'SOL', entityId: 'opco' }),
  }))
  expect(res.status).toBe(400)
})

test('POST rejects unknown entity', async () => {
  const res = await POST(new Request('http://localhost/api/admin/wallets', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ address: SOL_ADDR, label: 'Bad', chain: 'SOL', entityId: 'no-such-entity' }),
  }))
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body.code).toBe('admin.entity_not_found')
})

test('POST returns 409 on duplicate address', async () => {
  createdAddrs.push(SOL_ADDR)
  await db.insert(wallet).values({ address: SOL_ADDR, label: 'Existing', chain: 'SOL', entityId: 'opco' })
  const res = await POST(new Request('http://localhost/api/admin/wallets', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ address: SOL_ADDR, label: 'Dupe', chain: 'SOL', entityId: 'opco' }),
  }))
  expect(res.status).toBe(409)
})

test('POST rejects backfill=true on ETH', async () => {
  const res = await POST(new Request('http://localhost/api/admin/wallets', {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ address: ETH_ADDR, label: 'X', chain: 'ETH', entityId: 'opco', backfill: true }),
  }))
  expect(res.status).toBe(400)
})

test('GET unauthenticated returns 401', async () => {
  const res = await GET(new Request('http://localhost/api/admin/wallets'))
  expect(res.status).toBe(401)
})
