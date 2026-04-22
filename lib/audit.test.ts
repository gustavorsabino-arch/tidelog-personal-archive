import { test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { auditLog } from './db/schema/audit'
import { logAudit } from './audit'

test('logAudit inserts row with defaults', async () => {
  const action = `test.defaults.${crypto.randomUUID()}`
  await logAudit({ action })
  const rows = await db.select().from(auditLog).where(eq(auditLog.action, action))
  expect(rows.length).toBe(1)
  expect(rows[0].metadata).toEqual({})
  expect(rows[0].userId).toBeNull()
  expect(rows[0].resourceType).toBeNull()
  expect(rows[0].resourceId).toBeNull()
})

test('logAudit preserves metadata', async () => {
  const action = `test.metadata.${crypto.randomUUID()}`
  await logAudit({
    action,
    metadata: { reason: 'unit test', count: 42, nested: { flag: true } },
  })
  const [row] = await db.select().from(auditLog).where(eq(auditLog.action, action))
  expect(row.metadata).toEqual({ reason: 'unit test', count: 42, nested: { flag: true } })
})

test('logAudit persists resourceType and resourceId', async () => {
  const action = `test.resource.${crypto.randomUUID()}`
  await logAudit({
    action,
    resourceType: 'wallet',
    resourceId: 'abc123',
  })
  const [row] = await db.select().from(auditLog).where(eq(auditLog.action, action))
  expect(row.resourceType).toBe('wallet')
  expect(row.resourceId).toBe('abc123')
})
