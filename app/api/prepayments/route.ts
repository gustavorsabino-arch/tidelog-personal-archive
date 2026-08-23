import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { prepayment } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { ensureApprovalsSchema } from '@/lib/db/approvals-schema'
import { toDbEntity } from '@/lib/entity'
import { logAudit } from '@/lib/audit'
import { PREPAYMENT_SEEDS_BY_ENTITY } from '@/lib/prepayments/seed-data'
import { errorMessage } from '@/lib/errors'

export const runtime = 'nodejs'

/**
 * Prepayment register CRUD. The amortization schedule is derived
 * (straight-line) and reconciliation against QB happens client-side from
 * the live GL rows — this API only stores the terms.
 *
 * GET    ?entity=Opco                 (qb:post)
 * POST   { entity, prepaidAccount, vendorName, totalAmount, startMonth,
 *          months, description?, expenseGlAccount?, className?,
 *          sourceTxnId?, sourceDate?, notes? }        (admin:manage_data)
 * PATCH  { id, ...fields to update }                  (admin:manage_data)
 * DELETE ?id=…                                        (admin:manage_data)
 */

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

const MONTH_RE = /^\d{4}-\d{2}$/

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('qb:post', req)
  if (deny) return deny
  const entity = new URL(req.url).searchParams.get('entity')
  if (!entity) return NextResponse.json({ error: 'entity is required' }, { status: 400 })

  try {
    await ensureApprovalsSchema().catch(() => {})
    const entityId = toDbEntity(entity)

    // Self-healing seed: each entity's register is pre-loaded with the
    // contracts confirmed from its prepaid-account ledger (validated terms).
    // Any seed contract missing from the DB — first open, or rows lost for
    // whatever reason — is re-inserted, keyed by vendor + start month, so
    // the map is never empty. Rows already present (edited or archived) are
    // untouched.
    const seed = PREPAYMENT_SEEDS_BY_ENTITY[entityId]
    if (seed) {
      // The advisory lock serializes concurrent first-opens (the panel can
      // fire two GETs when switching tabs) — without it both requests see an
      // empty register and both insert, duplicating every contract.
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`prepayment-seed:${entityId}`}))`)

        const existing = await tx
          .select({
            id: prepayment.id,
            vendorName: prepayment.vendorName,
            startMonth: prepayment.startMonth,
            updatedBy: prepayment.updatedBy,
            createdAt: prepayment.createdAt,
          })
          .from(prepayment)
          .where(eq(prepayment.entityId, entityId))
          .orderBy(asc(prepayment.createdAt))

        // Heal duplicates a past race already created: per (vendor, start
        // month) keep one row — a user-edited row wins over seed rows,
        // otherwise the earliest — and delete the extra SEED rows only.
        const keyOf = (v: string, m: string) => `${v.trim().toLowerCase()}|${m}`
        const keeper = new Map<string, { id: string; updatedBy: string | null }>()
        const extraSeedIds: string[] = []
        for (const r of existing) {
          const key = keyOf(r.vendorName, r.startMonth)
          const cur = keeper.get(key)
          if (!cur) { keeper.set(key, r); continue }
          if (cur.updatedBy === 'ledger-seed' && r.updatedBy !== 'ledger-seed') {
            extraSeedIds.push(cur.id)
            keeper.set(key, r)
          } else if (r.updatedBy === 'ledger-seed') {
            extraSeedIds.push(r.id)
          }
        }
        if (extraSeedIds.length > 0) {
          await tx.delete(prepayment).where(inArray(prepayment.id, extraSeedIds))
        }

        const missing = seed.items
          .filter((s) => !keeper.has(keyOf(s.vendorName, s.startMonth)))
        if (missing.length > 0) {
          await tx.insert(prepayment).values(missing.map((s) => ({
            entityId,
            prepaidAccount: s.prepaidAccount ?? seed.defaultAccount,
            vendorName: s.vendorName,
            description: s.description,
            totalAmount: s.totalAmount.toFixed(2),
            startMonth: s.startMonth,
            months: s.months,
            expenseGlAccount: s.expenseGlAccount,
            className: s.className,
            sourceDate: s.sourceDate,
            updatedBy: 'ledger-seed',
          })))
        }
      })
    }

    const items = await db
      .select()
      .from(prepayment)
      .where(eq(prepayment.entityId, entityId))
      .orderBy(asc(prepayment.startMonth), asc(prepayment.vendorName))
    return NextResponse.json({ items })
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  const b = await req.json().catch(() => ({})) as Record<string, unknown>

  const entity = str(b.entity)
  const vendorName = str(b.vendorName)
  const startMonth = str(b.startMonth)
  const months = typeof b.months === 'number' ? Math.round(b.months) : NaN
  const totalAmount = typeof b.totalAmount === 'number' ? b.totalAmount : parseFloat(String(b.totalAmount))
  if (!entity || !vendorName) return NextResponse.json({ error: 'entity and vendorName are required' }, { status: 400 })
  if (!startMonth || !MONTH_RE.test(startMonth)) return NextResponse.json({ error: 'startMonth must be YYYY-MM' }, { status: 400 })
  if (!Number.isFinite(months) || months < 1 || months > 120) return NextResponse.json({ error: 'months must be 1–120' }, { status: 400 })
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return NextResponse.json({ error: 'totalAmount must be positive' }, { status: 400 })

  const [created] = await db.insert(prepayment).values({
    entityId: toDbEntity(entity),
    prepaidAccount: str(b.prepaidAccount) ?? '14000',
    vendorName,
    description: str(b.description),
    totalAmount: totalAmount.toFixed(2),
    startMonth,
    months,
    expenseGlAccount: str(b.expenseGlAccount),
    className: str(b.className),
    sourceTxnId: str(b.sourceTxnId),
    sourceDate: str(b.sourceDate),
    notes: str(b.notes),
    updatedBy: user.email,
  }).returning()

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'prepayment.created',
    resourceType: 'prepayment',
    resourceId: created.id,
    metadata: { entity, vendorName, totalAmount, startMonth, months, byEmail: user.email },
  }).catch(() => {})

  return NextResponse.json({ ok: true, item: created }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const id = str(b.id)
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: user.email }
  if ('vendorName' in b) {
    const v = str(b.vendorName)
    if (!v) return NextResponse.json({ error: 'vendorName cannot be empty' }, { status: 400 })
    set.vendorName = v
  }
  if ('description' in b) set.description = str(b.description)
  if ('totalAmount' in b) {
    const n = typeof b.totalAmount === 'number' ? b.totalAmount : parseFloat(String(b.totalAmount))
    if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'totalAmount must be positive' }, { status: 400 })
    set.totalAmount = n.toFixed(2)
  }
  if ('startMonth' in b) {
    const m = str(b.startMonth)
    if (!m || !MONTH_RE.test(m)) return NextResponse.json({ error: 'startMonth must be YYYY-MM' }, { status: 400 })
    set.startMonth = m
  }
  if ('months' in b) {
    const n = typeof b.months === 'number' ? Math.round(b.months) : NaN
    if (!Number.isFinite(n) || n < 1 || n > 120) return NextResponse.json({ error: 'months must be 1–120' }, { status: 400 })
    set.months = n
  }
  if ('expenseGlAccount' in b) set.expenseGlAccount = str(b.expenseGlAccount)
  if ('className' in b) set.className = str(b.className)
  if ('notes' in b) set.notes = str(b.notes)
  if ('status' in b) {
    if (b.status !== 'active' && b.status !== 'archived') {
      return NextResponse.json({ error: "status must be 'active' or 'archived'" }, { status: 400 })
    }
    set.status = b.status
  }

  const [updated] = await db.update(prepayment).set(set).where(eq(prepayment.id, id)).returning()
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'prepayment.updated',
    resourceType: 'prepayment',
    resourceId: id,
    metadata: { ...set, updatedAt: undefined, byEmail: user.email },
  }).catch(() => {})

  return NextResponse.json({ ok: true, item: updated })
}

export async function DELETE(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const deleted = await db.delete(prepayment)
    .where(and(eq(prepayment.id, id)))
    .returning()
  if (deleted.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'prepayment.deleted',
    resourceType: 'prepayment',
    resourceId: id,
    metadata: { vendorName: deleted[0].vendorName, byEmail: user.email },
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
