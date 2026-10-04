import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { vendorDefault } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { ensureApprovalsSchema } from '@/lib/db/approvals-schema'
import { logAudit } from '@/lib/audit'
import { seedVendorDefaultsIfEmpty } from '@/lib/vendors/defaults'

export const runtime = 'nodejs'

/**
 * Vendor master defaults (finance's Book12): vendor → GL account + class.
 * Picking a vendor on a transaction auto-fills these. Admin-managed.
 *
 * GET  — list all (self-heals the table and seeds from Book12 when empty)
 * POST — create  { vendorName, glAccount, glAccountName?, className? }
 * PATCH — update { vendorName, glAccount?, glAccountName?, className? }
 * DELETE ?name=… — remove
 */

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  try {
    await ensureApprovalsSchema().catch(() => {})
    const seeded = await seedVendorDefaultsIfEmpty()
    const vendors = await db.select().from(vendorDefault).orderBy(asc(vendorDefault.vendorName))
    return NextResponse.json({ vendors, seeded })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

type Body = { vendorName?: unknown; glAccount?: unknown; glAccountName?: unknown; className?: unknown }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function POST(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  await ensureApprovalsSchema().catch(() => {})
  const b = await req.json().catch(() => ({})) as Body
  const vendorName = str(b.vendorName)
  const glAccount = str(b.glAccount)
  if (!vendorName || !glAccount) {
    return NextResponse.json({ error: 'vendorName and glAccount are required' }, { status: 400 })
  }

  const [existing] = await db.select({ v: vendorDefault.vendorName })
    .from(vendorDefault).where(eq(vendorDefault.vendorName, vendorName)).limit(1)
  if (existing) {
    return NextResponse.json({ error: `Vendor "${vendorName}" already exists — edit it instead` }, { status: 409 })
  }

  const [created] = await db.insert(vendorDefault).values({
    vendorName,
    glAccount,
    glAccountName: str(b.glAccountName),
    className: str(b.className),
    updatedBy: user.email,
  }).returning()

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'vendor_default.created',
    resourceType: 'vendor_default',
    resourceId: vendorName,
    metadata: { glAccount, className: str(b.className), byEmail: user.email },
  }).catch(() => {})

  return NextResponse.json({ ok: true, vendor: created }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  await ensureApprovalsSchema().catch(() => {})
  const b = await req.json().catch(() => ({})) as Body
  const vendorName = str(b.vendorName)
  if (!vendorName) return NextResponse.json({ error: 'vendorName is required' }, { status: 400 })

  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: user.email }
  if ('glAccount' in b) {
    const gl = str(b.glAccount)
    if (!gl) return NextResponse.json({ error: 'glAccount cannot be empty' }, { status: 400 })
    set.glAccount = gl
  }
  if ('glAccountName' in b) set.glAccountName = str(b.glAccountName)
  if ('className' in b) set.className = str(b.className)

  const [updated] = await db.update(vendorDefault)
    .set(set)
    .where(eq(vendorDefault.vendorName, vendorName))
    .returning()
  if (!updated) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'vendor_default.updated',
    resourceType: 'vendor_default',
    resourceId: vendorName,
    metadata: { ...set, updatedAt: undefined, byEmail: user.email },
  }).catch(() => {})

  return NextResponse.json({ ok: true, vendor: updated })
}

export async function DELETE(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  await ensureApprovalsSchema().catch(() => {})
  const name = new URL(req.url).searchParams.get('name')?.trim()
  if (!name) return NextResponse.json({ error: 'name query param is required' }, { status: 400 })

  const deleted = await db.delete(vendorDefault).where(eq(vendorDefault.vendorName, name)).returning()
  if (deleted.length === 0) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'vendor_default.deleted',
    resourceType: 'vendor_default',
    resourceId: name,
    metadata: { byEmail: user.email },
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
