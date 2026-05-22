import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { wallet } from '@/lib/db/schema'
import { logAudit } from '@/lib/audit'

// PATCH /api/wallets/[address]
//   Body: { isBulkTreasury?: boolean }
//   Updates wallet config flags. Currently only `isBulkTreasury` (Wave 2c)
//   is editable via this endpoint; other wallet fields (label, accountCode,
//   etc.) remain managed via the seed/migration path.
//
// Permission: admin:manage_data (matches other admin data-mutation endpoints
// like /api/admin/qb/force-refresh — wallet config edits affect QB posting
// behavior, so they belong to the same permission tier).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  const { address } = await ctx.params

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected object' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const setMap: Record<string, unknown> = {}

  if ('isBulkTreasury' in b) {
    if (typeof b.isBulkTreasury !== 'boolean') {
      return NextResponse.json({ error: 'isBulkTreasury must be boolean' }, { status: 400 })
    }
    setMap.isBulkTreasury = b.isBulkTreasury
  }

  if (Object.keys(setMap).length === 0) {
    return NextResponse.json({ error: 'no recognized fields provided' }, { status: 400 })
  }

  const [existing] = await db.select().from(wallet).where(eq(wallet.address, address)).limit(1)
  if (!existing) {
    return NextResponse.json({ error: 'wallet not found' }, { status: 404 })
  }

  setMap.updatedAt = new Date()

  await db.update(wallet).set(setMap).where(eq(wallet.address, address))

  logAudit({
    userId: user?.id ?? null,
    action: 'wallet.update',
    resourceType: 'wallet',
    resourceId: address,
    metadata: {
      fields: Object.keys(setMap).filter(k => k !== 'updatedAt'),
      ...('isBulkTreasury' in setMap
        ? { isBulkTreasury: setMap.isBulkTreasury, previousIsBulkTreasury: existing.isBulkTreasury }
        : {}),
    },
  }).catch(() => { /* swallow */ })

  return NextResponse.json({ ok: true })
}
