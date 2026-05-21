import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { transaction, txQbState } from '@/lib/db/schema'
import { logAudit } from '@/lib/audit'

// PATCH /api/treasury/transactions/[id]/qb-state
//   Body: { description: string | null }
//
// Lazily creates the tx_qb_state row on first edit; subsequent edits upsert.
// `id` is the transaction.id UUID (the defaultRandom column on app.transaction).
// We look it up to learn the (tx_hash, wallet_address, direction, asset) composite
// key the tx_qb_state row needs.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requirePermission('qb:post', req)
  if (deny) return deny
  const { id } = await ctx.params

  // Parse + validate body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected object' }, { status: 400 })
  }
  const description = (body as { description?: unknown }).description
  if (description !== null && typeof description !== 'string') {
    return NextResponse.json({ error: 'description must be string or null' }, { status: 400 })
  }
  if (typeof description === 'string' && description.length > 4000) {
    return NextResponse.json({ error: 'description too long (max 4000)' }, { status: 400 })
  }

  // Look up the tx to learn the composite key for tx_qb_state.
  const txRow = await db.select().from(transaction).where(eq(transaction.id, id)).limit(1)
  if (txRow.length === 0) {
    return NextResponse.json({ error: 'transaction not found' }, { status: 404 })
  }
  const t = txRow[0]

  const now = new Date()
  const updatedBy = user?.id ?? null

  await db.insert(txQbState)
    .values({
      txHash: t.txHash,
      walletAddress: t.walletAddress,
      direction: t.direction,
      asset: t.asset,
      entityId: t.entityId,
      description,
      updatedBy,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [txQbState.txHash, txQbState.walletAddress, txQbState.direction, txQbState.asset],
      set: { description, updatedBy, updatedAt: now },
    })

  // Fire-and-forget audit. Failure here must not block the user response.
  logAudit({
    userId: updatedBy,
    action: 'tx_qb_state.update',
    resourceType: 'transaction',
    resourceId: id,
    metadata: { field: 'description', newLength: description === null ? null : description.length },
  }).catch(() => { /* intentional swallow */ })

  return NextResponse.json({ ok: true })
}
