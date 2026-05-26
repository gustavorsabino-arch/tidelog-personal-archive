import { test, expect, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet } from '@/lib/db/schema'
import { PATCH } from './route'

const ADMIN_HEADERS = {
  'x-user-id': 'dev-user',
  'x-user-email': 'admin@orca.so',
  'x-user-role': 'admin',
  'x-user-departments': '',
}

const SOL_ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

afterEach(async () => {
  await db.delete(wallet).where(eq(wallet.address, SOL_ADDR)).catch(() => {})
})

test('PATCH sets needs_backfill=true on external→internal transition', async () => {
  await db.insert(wallet).values({
    address: SOL_ADDR, label: 'External CP', chain: 'SOL', entityId: 'opco',
    type: 'external', hiddenFromFinance: false, needsBackfill: false,
  })
  const req = new Request(`http://localhost/api/wallets/${SOL_ADDR}`, {
    method: 'PATCH',
    headers: { ...ADMIN_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'internal' }),
  })
  const res = await PATCH(req as any, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(200)
  const [row] = await db.select().from(wallet).where(eq(wallet.address, SOL_ADDR))
  expect(row?.type).toBe('internal')
  expect(row?.needsBackfill).toBe(true)
})

test('PATCH label-only change does NOT touch needs_backfill', async () => {
  await db.insert(wallet).values({
    address: SOL_ADDR, label: 'Original', chain: 'SOL', entityId: 'opco',
    type: 'internal', hiddenFromFinance: false, needsBackfill: false,
  })
  const req = new Request(`http://localhost/api/wallets/${SOL_ADDR}`, {
    method: 'PATCH',
    headers: { ...ADMIN_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'Renamed' }),
  })
  const res = await PATCH(req as any, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(200)
  const [row] = await db.select().from(wallet).where(eq(wallet.address, SOL_ADDR))
  expect(row?.label).toBe('Renamed')
  expect(row?.needsBackfill).toBe(false)
})

test('PATCH rejects type=external + hiddenFromFinance=true combo', async () => {
  await db.insert(wallet).values({
    address: SOL_ADDR, label: 'X', chain: 'SOL', entityId: 'opco',
    type: 'internal', hiddenFromFinance: false, needsBackfill: false,
  })
  const req = new Request(`http://localhost/api/wallets/${SOL_ADDR}`, {
    method: 'PATCH',
    headers: { ...ADMIN_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'external', hiddenFromFinance: true }),
  })
  const res = await PATCH(req as any, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(400)
})
