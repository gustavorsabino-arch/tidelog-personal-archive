import { test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { user, account } from '@/lib/db/schema/auth'
import { userDepartment } from '@/lib/db/schema/authz'
import { auditLog } from '@/lib/db/schema/audit'
import { POST } from './route'

const ADMIN_HEADERS = (id: string, email: string) => ({
  'x-user-id': id,
  'x-user-email': email,
  'x-user-role': 'admin',
  'x-user-departments': '',
  'content-type': 'application/json',
})

const VIEWER_HEADERS = (id: string, email: string) => ({
  'x-user-id': id,
  'x-user-email': email,
  'x-user-role': 'budget_viewer',
  'x-user-departments': 'General',
  'content-type': 'application/json',
})

async function makeUser(role: 'admin' | 'budget_viewer' | null = null) {
  const id = crypto.randomUUID()
  const email = `${role ?? 'noone'}-${id}@orca.so`
  await db.insert(user).values({
    id, name: 'Test User', email, emailVerified: true, role,
  })
  return { id, email }
}

async function cleanup(ids: string[]) {
  for (const id of ids) {
    await db.delete(user).where(eq(user.id, id)).catch(() => {})
  }
}

test('admin can create a new user with just email', async () => {
  const admin = await makeUser('admin')
  const newEmail = `new-${crypto.randomUUID()}@orca.so`

  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ email: newEmail }),
  })
  const res = await POST(req)
  expect(res.status).toBe(201)

  const body = await res.json()
  expect(body.user.email).toBe(newEmail)
  expect(body.user.role).toBeNull()
  expect(body.user.id).toBeTruthy()

  const [created] = await db.select().from(user).where(eq(user.email, newEmail))
  expect(created).toBeTruthy()
  expect(created.role).toBeNull()

  const audits = await db.select().from(auditLog).where(eq(auditLog.resourceId, created.id))
  expect(audits.some((a) => a.action === 'user.created')).toBe(true)

  await cleanup([admin.id, created.id])
})

test('admin can create a user with role and departments', async () => {
  const admin = await makeUser('admin')
  const newEmail = `viewer-${crypto.randomUUID()}@orca.so`

  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({
      email: newEmail,
      role: 'budget_viewer',
      departments: ['General', 'Ops'],
    }),
  })
  const res = await POST(req)
  expect(res.status).toBe(201)

  const [created] = await db.select().from(user).where(eq(user.email, newEmail))
  expect(created.role).toBe('budget_viewer')

  const depts = await db.select().from(userDepartment).where(eq(userDepartment.userId, created.id))
  expect(depts.map((d) => d.department).sort()).toEqual(['General', 'Ops'])

  await cleanup([admin.id, created.id])
})

test('lowercases email on create', async () => {
  const admin = await makeUser('admin')
  const mixed = `Mixed-${crypto.randomUUID()}@Orca.So`

  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ email: mixed }),
  })
  const res = await POST(req)
  expect(res.status).toBe(201)

  const body = await res.json()
  expect(body.user.email).toBe(mixed.toLowerCase())

  await cleanup([admin.id, body.user.id])
})

test('rejects duplicate email already in user table with 409', async () => {
  const admin = await makeUser('admin')
  const existing = await makeUser('budget_viewer')

  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ email: existing.email }),
  })
  const res = await POST(req)
  expect(res.status).toBe(409)

  await cleanup([admin.id, existing.id])
})

test('rejects email already linked as alias with 409', async () => {
  const admin = await makeUser('admin')
  const owner = await makeUser('budget_viewer')
  const alias = `alias-${crypto.randomUUID()}@orca.so`
  await db.insert(account).values({
    id: crypto.randomUUID(), userId: owner.id, accountId: alias,
    providerId: 'email-alias', email: alias,
  })

  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ email: alias }),
  })
  const res = await POST(req)
  expect(res.status).toBe(409)

  await cleanup([admin.id, owner.id])
})

test('non-admin gets 403', async () => {
  const viewer = await makeUser('budget_viewer')
  const newEmail = `x-${crypto.randomUUID()}@orca.so`

  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: VIEWER_HEADERS(viewer.id, viewer.email),
    body: JSON.stringify({ email: newEmail }),
  })
  const res = await POST(req)
  expect(res.status).toBe(403)

  await cleanup([viewer.id])
})

test('rejects invalid email with 400', async () => {
  const admin = await makeUser('admin')

  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ email: 'not-an-email' }),
  })
  const res = await POST(req)
  expect(res.status).toBe(400)

  await cleanup([admin.id])
})

test('rejects invalid role with 400', async () => {
  const admin = await makeUser('admin')
  const newEmail = `x-${crypto.randomUUID()}@orca.so`

  const req = new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ email: newEmail, role: 'superadmin' }),
  })
  const res = await POST(req)
  expect(res.status).toBe(400)

  await cleanup([admin.id])
})
