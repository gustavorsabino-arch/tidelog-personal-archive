import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { user, account } from '@/lib/db/schema/auth'
import { userDepartment, financeApprover } from '@/lib/db/schema/authz'
import { requirePermission } from '@/lib/auth/require-permission'
import { isEmailDomainAllowed, parseAllowedDomains } from '@/lib/auth/email-domain'
import { logAudit } from '@/lib/audit'

export async function GET(req: Request) {
  const { deny } = await requirePermission('admin:manage_users', req)
  if (deny) return deny

  const users = await db.select({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    banned: user.banned,
    createdAt: user.createdAt,
  }).from(user)

  const accs = await db.select().from(account)
  const depts = await db.select().from(userDepartment)
  const financeRows = await db.select().from(financeApprover).catch(() => [])
  const financeIds = new Set(financeRows.map((f) => f.userId))

  const byUser = new Map<string, { linkedEmails: string[]; departments: string[] }>()
  for (const u of users) byUser.set(u.id, { linkedEmails: [], departments: [] })

  for (const a of accs) {
    const bucket = byUser.get(a.userId)
    if (!bucket) continue
    if (a.email && !bucket.linkedEmails.includes(a.email)) {
      bucket.linkedEmails.push(a.email)
    }
  }

  for (const d of depts) {
    byUser.get(d.userId)?.departments.push(d.department)
  }

  const payload = users.map((u) => {
    const bucket = byUser.get(u.id) ?? { linkedEmails: [], departments: [] }
    // Include primary email plus any linked emails, deduped
    const emails = [u.email, ...bucket.linkedEmails]
      .filter((e, i, arr) => e && arr.indexOf(e) === i)
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      emails,
      role: u.role,
      departments: bucket.departments,
      financeApprover: financeIds.has(u.id),
      banned: u.banned,
      createdAt: u.createdAt,
    }
  })

  return NextResponse.json({ users: payload })
}

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'budget_viewer']).nullable().optional(),
  departments: z.array(z.string().min(1)).optional(),
})

export async function POST(req: Request) {
  const { user: me, deny } = await requirePermission('admin:manage_users', req)
  if (deny) return deny

  let body: z.infer<typeof CreateUserSchema>
  try {
    body = CreateUserSchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'validation.failed', details: (err as any).issues ?? null },
      { status: 400 },
    )
  }

  const email = body.email.toLowerCase()

  const allowedDomains = parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS)
  if (!isEmailDomainAllowed(email, allowedDomains)) {
    return NextResponse.json(
      { error: `Email domain not allowed (configured: ${allowedDomains.join(', ') || 'none'})`, code: 'admin.disallowed_domain' },
      { status: 403 },
    )
  }

  // Reject if email collides with any existing user.email OR account.email
  const [userConflict] = await db.select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  const [acctConflict] = await db.select({ userId: account.userId })
    .from(account)
    .where(eq(account.email, email))
    .limit(1)
  if (userConflict || acctConflict) {
    return NextResponse.json(
      { error: 'Email already in use', code: 'admin.email_conflict' },
      { status: 409 },
    )
  }

  const id = crypto.randomUUID()
  const role = body.role ?? null

  await db.insert(user).values({
    id,
    name: body.name ?? email,
    email,
    emailVerified: true, // CF Access verifies email identity; no separate verification flow
    role,
  })

  if (body.departments && body.departments.length > 0) {
    await db.insert(userDepartment).values(
      body.departments.map((d) => ({ userId: id, department: d })),
    )
  }

  await logAudit({
    userId: me.id === 'dev-user' ? null : me.id,
    action: 'user.created',
    resourceType: 'user',
    resourceId: id,
    metadata: {
      email,
      role,
      departments: body.departments ?? [],
      byEmail: me.email,
    },
  })

  return NextResponse.json(
    {
      user: {
        id,
        email,
        name: body.name ?? email,
        role,
        departments: body.departments ?? [],
        banned: false,
      },
    },
    { status: 201 },
  )
}
