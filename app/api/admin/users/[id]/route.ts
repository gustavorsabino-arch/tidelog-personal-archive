import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { user, account } from '@/lib/db/schema/auth'
import { userDepartment } from '@/lib/db/schema/authz'
import { requirePermission } from '@/lib/auth/require-permission'
import { isEmailDomainAllowed, parseAllowedDomains } from '@/lib/auth/email-domain'
import { logAudit } from '@/lib/audit'

const UpdateUserSchema = z.object({
  role: z.enum(['admin', 'budget_viewer']).nullable().optional(),
  departments: z.array(z.string().min(1)).optional(),
  banned: z.boolean().optional(),
  linkEmail: z.string().email().optional(),
  unlinkEmail: z.string().email().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user: me, deny } = await requirePermission('admin:manage_users', req)
  if (deny) return deny

  const { id } = await params

  let body: z.infer<typeof UpdateUserSchema>
  try {
    body = UpdateUserSchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'validation.failed', details: (err as any).issues ?? null },
      { status: 400 },
    )
  }

  const [existing] = await db.select().from(user).where(eq(user.id, id)).limit(1)
  if (!existing) {
    return NextResponse.json(
      { error: 'User not found', code: 'admin.user_not_found' },
      { status: 404 },
    )
  }

  if (id === me.id && 'role' in body && body.role !== 'admin') {
    return NextResponse.json(
      { error: 'Cannot demote your own admin account', code: 'admin.self_demote' },
      { status: 400 },
    )
  }

  const changes: Record<string, unknown> = {}

  if ('role' in body) {
    const newRole = body.role ?? null
    await db.update(user)
      .set({ role: newRole, updatedAt: new Date() })
      .where(eq(user.id, id))
    await logAudit({
      userId: me.id === 'dev-user' ? null : me.id,
      action: 'role.assigned',
      resourceType: 'user',
      resourceId: id,
      metadata: { previous: existing.role, new: newRole, byEmail: me.email },
    })
    changes.role = newRole
  }

  if (body.departments) {
    await db.delete(userDepartment).where(eq(userDepartment.userId, id))
    if (body.departments.length > 0) {
      await db.insert(userDepartment).values(
        body.departments.map((d) => ({ userId: id, department: d })),
      )
    }
    await logAudit({
      userId: me.id === 'dev-user' ? null : me.id,
      action: 'departments.assigned',
      resourceType: 'user',
      resourceId: id,
      metadata: { departments: body.departments, byEmail: me.email },
    })
    changes.departments = body.departments
  }

  if ('banned' in body && body.banned !== undefined) {
    await db.update(user)
      .set({ banned: body.banned, updatedAt: new Date() })
      .where(eq(user.id, id))
    await logAudit({
      userId: me.id === 'dev-user' ? null : me.id,
      action: body.banned ? 'user.banned' : 'user.unbanned',
      resourceType: 'user',
      resourceId: id,
      metadata: { byEmail: me.email },
    })
    changes.banned = body.banned
  }

  if (body.linkEmail) {
    const email = body.linkEmail.toLowerCase()
    const allowedDomains = parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS)
    if (!isEmailDomainAllowed(email, allowedDomains)) {
      return NextResponse.json(
        { error: `Email domain not allowed (configured: ${allowedDomains.join(', ') || 'none'})`, code: 'admin.disallowed_domain' },
        { status: 403 },
      )
    }
    // Reject if email already linked to any user (including same user)
    const [conflict] = await db.select({ userId: account.userId })
      .from(account)
      .where(eq(account.email, email))
      .limit(1)
    if (conflict) {
      return NextResponse.json(
        { error: 'Email already linked to a user', code: 'admin.email_conflict' },
        { status: 409 },
      )
    }
    await db.insert(account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: email,
      providerId: 'email-alias',
      email,
    })
    await logAudit({
      userId: me.id === 'dev-user' ? null : me.id,
      action: 'account.linked',
      resourceType: 'user',
      resourceId: id,
      metadata: { email, byEmail: me.email },
    })
    changes.linkedEmail = email
  }

  if (body.unlinkEmail) {
    const email = body.unlinkEmail.toLowerCase()
    const deleted = await db.delete(account)
      .where(and(
        eq(account.userId, id),
        eq(account.email, email),
        eq(account.providerId, 'email-alias'),
      ))
      .returning()
    if (deleted.length === 0) {
      return NextResponse.json(
        { error: 'Email not linked to this user', code: 'admin.email_not_linked' },
        { status: 404 },
      )
    }
    await logAudit({
      userId: me.id === 'dev-user' ? null : me.id,
      action: 'account.unlinked',
      resourceType: 'user',
      resourceId: id,
      metadata: { email, byEmail: me.email },
    })
    changes.unlinkedEmail = email
  }

  return NextResponse.json({ ok: true, changes })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user: me, deny } = await requirePermission('admin:manage_users', req)
  if (deny) return deny

  const { id } = await params

  if (id === me.id) {
    return NextResponse.json(
      { error: 'Cannot delete your own account', code: 'admin.self_delete' },
      { status: 400 },
    )
  }

  const [existing] = await db.select().from(user).where(eq(user.id, id)).limit(1)
  if (!existing) {
    return NextResponse.json(
      { error: 'User not found', code: 'admin.user_not_found' },
      { status: 404 },
    )
  }

  // Cascade via FK (onDelete: 'cascade') removes account, session, user_department rows.
  await db.delete(user).where(eq(user.id, id))

  await logAudit({
    userId: me.id === 'dev-user' ? null : me.id,
    action: 'user.deleted',
    resourceType: 'user',
    resourceId: id,
    metadata: { email: existing.email, byEmail: me.email },
  })

  return NextResponse.json({ ok: true })
}
