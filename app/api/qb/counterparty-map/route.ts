import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { counterpartyGlMap } from '@/lib/db/schema'
import { toDbEntity } from '@/lib/entity'
import { logAudit } from '@/lib/audit'

// GET /api/qb/counterparty-map?entity=Opco
// Returns the full memorized map for one entity. Read-only.
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny

  const entity = req.nextUrl.searchParams.get('entity')
  if (!entity) {
    return NextResponse.json({ error: 'entity required' }, { status: 400 })
  }
  const dbEntity = toDbEntity(entity)

  const rows = await db
    .select()
    .from(counterpartyGlMap)
    .where(eq(counterpartyGlMap.entityId, dbEntity))

  return NextResponse.json({
    mappings: rows.map(r => ({
      counterpartyAddress: r.counterpartyAddress,
      glAccountNumber: r.glAccountNumber,
      updatedAt: r.updatedAt.toISOString(),
    })),
  })
}

// PUT /api/qb/counterparty-map
//   Body: { entity: string, counterpartyAddress: string, glAccountNumber: string }
// Upserts one (entity, counterparty) → gl mapping. Called automatically by
// the transactions page whenever a user picks a GL via the Counterparty GL
// dropdown (D3: auto-memorize).
export async function PUT(req: NextRequest) {
  const { user, deny } = await requirePermission('qb:post', req)
  if (deny) return deny

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected object' }, { status: 400 })
  }
  const b = body as { entity?: unknown; counterpartyAddress?: unknown; glAccountNumber?: unknown }

  if (typeof b.entity !== 'string' || !b.entity) {
    return NextResponse.json({ error: 'entity required (string)' }, { status: 400 })
  }
  if (typeof b.counterpartyAddress !== 'string' || !b.counterpartyAddress) {
    return NextResponse.json({ error: 'counterpartyAddress required (string)' }, { status: 400 })
  }
  if (typeof b.glAccountNumber !== 'string' || !b.glAccountNumber) {
    return NextResponse.json({ error: 'glAccountNumber required (string)' }, { status: 400 })
  }
  if (b.glAccountNumber.length > 64) {
    return NextResponse.json({ error: 'glAccountNumber too long (max 64)' }, { status: 400 })
  }

  const dbEntity = toDbEntity(b.entity)
  const now = new Date()
  const updatedBy = user?.id ?? null

  // Capture prior value for audit metadata
  const priorRows = await db
    .select({ prev: counterpartyGlMap.glAccountNumber })
    .from(counterpartyGlMap)
    .where(and(
      eq(counterpartyGlMap.entityId, dbEntity),
      eq(counterpartyGlMap.counterpartyAddress, b.counterpartyAddress),
    ))
    .limit(1)

  await db.insert(counterpartyGlMap)
    .values({
      entityId: dbEntity,
      counterpartyAddress: b.counterpartyAddress,
      glAccountNumber: b.glAccountNumber,
      updatedAt: now,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [counterpartyGlMap.entityId, counterpartyGlMap.counterpartyAddress],
      set: { glAccountNumber: b.glAccountNumber, updatedAt: now, updatedBy },
    })

  logAudit({
    userId: updatedBy,
    action: 'counterparty_gl_map.upsert',
    resourceType: 'counterparty_gl_map',
    metadata: {
      entity: b.entity,
      counterpartyAddress: b.counterpartyAddress,
      glAccountNumber: b.glAccountNumber,
      prevGlAccount: priorRows[0]?.prev ?? null,
    },
  }).catch(() => { /* swallow */ })

  return NextResponse.json({ ok: true })
}

// DELETE /api/qb/counterparty-map?entity=Opco&counterpartyAddress=...
// Removes the memorized default for a counterparty. Triggered by the
// transactions page when the user clicks ∅ on a counterparty GL cell —
// aggressive clear so inheriting siblings lose the italic default too.
// Sibling rows that have their own per-tx override are untouched.
export async function DELETE(req: NextRequest) {
  const { user, deny } = await requirePermission('qb:post', req)
  if (deny) return deny

  const entity = req.nextUrl.searchParams.get('entity')
  const counterpartyAddress = req.nextUrl.searchParams.get('counterpartyAddress')
  if (!entity) {
    return NextResponse.json({ error: 'entity required' }, { status: 400 })
  }
  if (!counterpartyAddress) {
    return NextResponse.json({ error: 'counterpartyAddress required' }, { status: 400 })
  }
  const dbEntity = toDbEntity(entity)

  const prior = await db
    .select({ prev: counterpartyGlMap.glAccountNumber })
    .from(counterpartyGlMap)
    .where(and(
      eq(counterpartyGlMap.entityId, dbEntity),
      eq(counterpartyGlMap.counterpartyAddress, counterpartyAddress),
    ))
    .limit(1)

  await db
    .delete(counterpartyGlMap)
    .where(and(
      eq(counterpartyGlMap.entityId, dbEntity),
      eq(counterpartyGlMap.counterpartyAddress, counterpartyAddress),
    ))

  logAudit({
    userId: user?.id ?? null,
    action: 'counterparty_gl_map.delete',
    resourceType: 'counterparty_gl_map',
    metadata: {
      entity,
      counterpartyAddress,
      prevGlAccount: prior[0]?.prev ?? null,
    },
  }).catch(() => { /* swallow */ })

  return NextResponse.json({ ok: true })
}
