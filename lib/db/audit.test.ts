import { test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from './index'
import { auditLog } from './schema/audit'

test('audit_log accepts INSERT', async () => {
  const [row] = await db.insert(auditLog).values({
    action: 'test.insert',
    metadata: { reason: 'audit test' },
  }).returning()

  expect(row.id).toBeDefined()
  expect(row.action).toBe('test.insert')
  expect(row.metadata).toEqual({ reason: 'audit test' })
})

test('audit_log rejects UPDATE', async () => {
  const [row] = await db.insert(auditLog).values({
    action: 'test.update-attempt',
    metadata: {},
  }).returning()

  // Drizzle's query builder is thenable but only executes when awaited.
  // Wrap in an async IIFE so expect().rejects sees a real Promise.
  await expect(
    (async () => {
      await db.update(auditLog)
        .set({ action: 'test.modified' })
        .where(eq(auditLog.id, row.id))
    })()
  ).rejects.toThrow(/append-only/)
})

test('audit_log rejects DELETE', async () => {
  const [row] = await db.insert(auditLog).values({
    action: 'test.delete-attempt',
    metadata: {},
  }).returning()

  await expect(
    (async () => {
      await db.delete(auditLog).where(eq(auditLog.id, row.id))
    })()
  ).rejects.toThrow(/append-only/)
})
