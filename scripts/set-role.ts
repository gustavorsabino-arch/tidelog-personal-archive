#!/usr/bin/env bun
/**
 * Seed or update a user's role + departments.
 *
 *   bun scripts/set-role.ts admin amina@orca.so
 *   bun scripts/set-role.ts Legal,Finance bob@orca.so
 *
 * First arg: 'admin' OR a comma-separated list of departments (→ budget_viewer).
 * Second arg: email.
 *
 * Idempotent: creates the user if missing, replaces role + departments otherwise.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema/auth'
import { userDepartment } from '@/lib/db/schema/authz'

const roleArg = process.argv[2]
const email = process.argv[3]?.toLowerCase()

if (!roleArg || !email || !email.includes('@')) {
  console.error('usage: bun scripts/set-role.ts <admin|dept,dept,...> <email>')
  process.exit(1)
}

const isAdmin = roleArg === 'admin'
const departments = isAdmin
  ? []
  : roleArg.split(',').map((s) => s.trim()).filter(Boolean)

if (!isAdmin && departments.length === 0) {
  console.error('departments list is empty; use "admin" or at least one department name')
  process.exit(1)
}

const role = isAdmin ? 'admin' : 'budget_viewer'

const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1)

let userId: string
if (existing) {
  await db.update(user).set({ role, banned: false }).where(eq(user.id, existing.id))
  userId = existing.id
  console.log(`updated ${email} → role=${role}`)
} else {
  userId = crypto.randomUUID()
  await db.insert(user).values({
    id: userId,
    name: email,
    email,
    emailVerified: true,
    role,
  })
  console.log(`created ${email} with role=${role}`)
}

await db.delete(userDepartment).where(eq(userDepartment.userId, userId))
if (departments.length > 0) {
  await db.insert(userDepartment).values(departments.map((d) => ({ userId, department: d })))
  console.log(`  departments: ${departments.join(', ')}`)
}

process.exit(0)
