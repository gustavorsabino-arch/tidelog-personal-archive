import { test, expect, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, transaction, balanceSnapshot } from '@/lib/db/schema'
import { DELETE } from './route'

const ADMIN_HEADERS = {
  'x-user-id': 'dev-user',
  'x-user-email': 'admin@orca.so',
  'x-user-role': 'admin',
  'x-user-departments': '',
}

const SOL_ADDR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

afterEach(async () => {
  await db.delete(transaction).where(eq(transaction.walletAddress, SOL_ADDR)).catch(() => {})
  await db.delete(balanceSnapshot).where(eq(balanceSnapshot.walletAddress, SOL_ADDR)).catch(() => {})
  await db.delete(wallet).where(eq(wallet.address, SOL_ADDR)).catch(() => {})
})

test('DELETE rejects unknown wallet with 404', async () => {
  const req = new Request('http://localhost/api/admin/wallets/UNKNOWN', { method: 'DELETE', headers: ADMIN_HEADERS })
  const res = await DELETE(req, { params: Promise.resolve({ address: 'UNKNOWN' }) })
  expect(res.status).toBe(404)
})

test('DELETE removes a wallet with no transactions cleanly', async () => {
  await db.insert(wallet).values({ address: SOL_ADDR, label: 'temp', chain: 'SOL', entityId: 'opco' })
  const req = new Request('http://localhost/api/admin/wallets/x', { method: 'DELETE', headers: ADMIN_HEADERS })
  const res = await DELETE(req, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.deletedTxCount).toBe(0)
  expect(body.gainsRecomputed).toBeNull()

  const [walletGone] = await db.select().from(wallet).where(eq(wallet.address, SOL_ADDR))
  expect(walletGone).toBeUndefined()
})

test('DELETE cascades transactions + snapshots', async () => {
  await db.insert(wallet).values({ address: SOL_ADDR, label: 'temp', chain: 'SOL', entityId: 'opco' })
  await db.insert(transaction).values({
    txHash: 'testTx1', walletAddress: SOL_ADDR, entityId: 'opco',
    blockTime: new Date(), asset: 'SOL', qty: '1', direction: 'in',
  })
  await db.insert(balanceSnapshot).values({
    date: '2026-05-22', walletAddress: SOL_ADDR, token: 'SOL', amount: '1.5',
  })

  const req = new Request('http://localhost/api/admin/wallets/x', { method: 'DELETE', headers: ADMIN_HEADERS })
  const res = await DELETE(req, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.deletedTxCount).toBe(1)
  expect(body.deletedSnapshotCount).toBe(1)
  // gainsRecomputed should be set (we had a tx). Don't assert success since gains recompute reads QB; just check the key is present.
  expect(body.gainsRecomputed).toBeDefined()

  const txs = await db.select().from(transaction).where(eq(transaction.walletAddress, SOL_ADDR))
  expect(txs.length).toBe(0)
  const snaps = await db.select().from(balanceSnapshot).where(eq(balanceSnapshot.walletAddress, SOL_ADDR))
  expect(snaps.length).toBe(0)
})

test('non-admin returns 403', async () => {
  await db.insert(wallet).values({ address: SOL_ADDR, label: 'x', chain: 'SOL', entityId: 'opco' })
  const VIEWER = { ...ADMIN_HEADERS, 'x-user-role': 'budget_viewer', 'x-user-departments': 'General' }
  const req = new Request('http://localhost/api/admin/wallets/x', { method: 'DELETE', headers: VIEWER })
  const res = await DELETE(req, { params: Promise.resolve({ address: SOL_ADDR }) })
  expect(res.status).toBe(403)
})
