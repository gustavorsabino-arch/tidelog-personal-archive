import { test, expect, afterAll } from 'bun:test'
import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { user, account } from '@/lib/db/schema/auth'
import { userDepartment } from '@/lib/db/schema/authz'
import { auditLog } from '@/lib/db/schema/audit'
import { PATCH } from './route'

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

test('admin can assign role', async () => {
  const admin = await makeUser('admin')
  const target = await makeUser(null)

  const req = new Request(`http://localhost/api/admin/users/${target.id}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ role: 'budget_viewer' }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: target.id }) })
  expect(res.status).toBe(200)

  const [updated] = await db.select().from(user).where(eq(user.id, target.id))
  expect(updated.role).toBe('budget_viewer')

  const audits = await db.select().from(auditLog).where(eq(auditLog.resourceId, target.id))
  expect(audits.some((a) => a.action === 'role.assigned')).toBe(true)

  await cleanup([admin.id, target.id])
})

test('admin can clear role by setting null', async () => {
  const admin = await makeUser('admin')
  const target = await makeUser('budget_viewer')

  const req = new Request(`http://localhost/api/admin/users/${target.id}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ role: null }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: target.id }) })
  expect(res.status).toBe(200)

  const [updated] = await db.select().from(user).where(eq(user.id, target.id))
  expect(updated.role).toBeNull()

  await cleanup([admin.id, target.id])
})

test('admin can set departments (replaces existing)', async () => {
  const admin = await makeUser('admin')
  const target = await makeUser('budget_viewer')
  await db.insert(userDepartment).values({ userId: target.id, department: 'OldDept' })

  const req = new Request(`http://localhost/api/admin/users/${target.id}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ departments: ['General', 'Ops'] }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: target.id }) })
  expect(res.status).toBe(200)

  const depts = await db.select().from(userDepartment).where(eq(userDepartment.userId, target.id))
  const names = depts.map((d) => d.department).sort()
  expect(names).toEqual(['General', 'Ops'])

  await cleanup([admin.id, target.id])
})

test('admin can empty departments', async () => {
  const admin = await makeUser('admin')
  const target = await makeUser('budget_viewer')
  await db.insert(userDepartment).values({ userId: target.id, department: 'General' })

  const req = new Request(`http://localhost/api/admin/users/${target.id}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ departments: [] }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: target.id }) })
  expect(res.status).toBe(200)

  const depts = await db.select().from(userDepartment).where(eq(userDepartment.userId, target.id))
  expect(depts.length).toBe(0)

  await cleanup([admin.id, target.id])
})

test('admin can link a new email to user', async () => {
  const admin = await makeUser('admin')
  const target = await makeUser('budget_viewer')
  const alias = `alias-${target.id}@orca.so`

  const req = new Request(`http://localhost/api/admin/users/${target.id}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ linkEmail: alias }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: target.id }) })
  expect(res.status).toBe(200)

  const accs = await db.select().from(account).where(and(
    eq(account.userId, target.id),
    eq(account.email, alias.toLowerCase()),
  ))
  expect(accs.length).toBe(1)

  await cleanup([admin.id, target.id])
})

test('admin cannot link an email already linked to another user', async () => {
  const admin = await makeUser('admin')
  const a = await makeUser('budget_viewer')
  const b = await makeUser('budget_viewer')
  const shared = `shared-${a.id}@orca.so`

  await db.insert(account).values({
    id: crypto.randomUUID(), userId: a.id, accountId: shared,
    providerId: 'email-alias', email: shared,
  })

  const req = new Request(`http://localhost/api/admin/users/${b.id}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ linkEmail: shared }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: b.id }) })
  expect(res.status).toBe(409)

  await cleanup([admin.id, a.id, b.id])
})

test('admin can unlink a previously-linked email', async () => {
  const admin = await makeUser('admin')
  const target = await makeUser('budget_viewer')
  const alias = `to-unlink-${target.id}@orca.so`
  await db.insert(account).values({
    id: crypto.randomUUID(), userId: target.id, accountId: alias,
    providerId: 'email-alias', email: alias,
  })

  const req = new Request(`http://localhost/api/admin/users/${target.id}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ unlinkEmail: alias }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: target.id }) })
  expect(res.status).toBe(200)

  const accs = await db.select().from(account).where(and(
    eq(account.userId, target.id),
    eq(account.email, alias.toLowerCase()),
  ))
  expect(accs.length).toBe(0)

  await cleanup([admin.id, target.id])
})

test('non-admin gets 403', async () => {
  const viewer = await makeUser('budget_viewer')
  const target = await makeUser('budget_viewer')

  const req = new Request(`http://localhost/api/admin/users/${target.id}`, {
    method: 'PATCH',
    headers: VIEWER_HEADERS(viewer.id, viewer.email),
    body: JSON.stringify({ role: 'admin' }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: target.id }) })
  expect(res.status).toBe(403)

  await cleanup([viewer.id, target.id])
})

test('returns 404 for unknown user id', async () => {
  const admin = await makeUser('admin')
  const ghostId = crypto.randomUUID()

  const req = new Request(`http://localhost/api/admin/users/${ghostId}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ role: 'admin' }),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: ghostId }) })
  expect(res.status).toBe(404)

  await cleanup([admin.id])
})

test('rejects invalid body with 400', async () => {
  const admin = await makeUser('admin')
  const target = await makeUser('budget_viewer')

  const req = new Request(`http://localhost/api/admin/users/${target.id}`, {
    method: 'PATCH',
    headers: ADMIN_HEADERS(admin.id, admin.email),
    body: JSON.stringify({ role: 'superadmin' }),  // not a valid role
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: target.id }) })
  expect(res.status).toBe(400)

  await cleanup([admin.id, target.id])
})
