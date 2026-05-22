import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { wallet } from '@/lib/db/schema'
import { logAudit } from '@/lib/audit'

// PATCH /api/wallets/[address]
//   Body: { isBulkTreasury?: boolean; label?: string; accountCode?: string | null }
//   Updates wallet config fields. All fields are live-joined at read time
//   (no historical impact on existing transaction / balance_snapshot rows),
//   so edits are non-destructive and take effect on next page load.
//
//   Editable fields:
//     - isBulkTreasury — QB posting aggregation flag (Wave 2c)
//     - label          — display label, 1-80 chars
//     - accountCode    — GL mapping for balance-sheet reconciliation; nullable
//
//   Fields that are NOT editable (would require cascade work — see backlog):
//     - entityId       — transaction rows store entity_id at write time
//     - chain          — parser is chain-specific
//     - address        — primary key
//     - isExternal / overviewOnly / includeInOverview — safe-to-edit but not exposed here yet
//
// Permission: admin:manage_data.
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

  if ('label' in b) {
    if (typeof b.label !== 'string' || b.label.trim().length === 0 || b.label.length > 80) {
      return NextResponse.json({ error: 'label must be a non-empty string up to 80 chars' }, { status: 400 })
    }
    setMap.label = b.label
  }

  if ('accountCode' in b) {
    if (b.accountCode !== null && typeof b.accountCode !== 'string') {
      return NextResponse.json({ error: 'accountCode must be a string or null' }, { status: 400 })
    }
    if (typeof b.accountCode === 'string' && b.accountCode.length > 80) {
      return NextResponse.json({ error: 'accountCode must be 80 chars or fewer' }, { status: 400 })
    }
    // Treat empty string as null so the column doesn't accumulate '' entries.
    setMap.accountCode = b.accountCode === '' ? null : b.accountCode
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
      ...('label' in setMap
        ? { label: setMap.label, previousLabel: existing.label }
        : {}),
      ...('accountCode' in setMap
        ? { accountCode: setMap.accountCode, previousAccountCode: existing.accountCode }
        : {}),
    },
  }).catch(() => { /* swallow */ })

  return NextResponse.json({ ok: true })
}
