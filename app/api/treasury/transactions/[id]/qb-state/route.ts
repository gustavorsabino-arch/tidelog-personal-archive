import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { transaction, txQbState, qbPost } from '@/lib/db/schema'
import { logAudit } from '@/lib/audit'

// PATCH /api/treasury/transactions/[id]/qb-state
//   Body: any subset of { description, glAccountOverride, counterpartyGlOverride }
//     - All fields are `string | null`
//     - Fields NOT present in the body are left untouched (only-update-provided)
//     - Fields present and set to `null` clear that field on the row
//
// Lazily creates the tx_qb_state row on first edit; subsequent edits upsert.
// `id` is the transaction.id UUID; we look it up to learn the composite key
// (tx_hash, wallet_address, direction, asset) the tx_qb_state row needs.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requirePermission('qb:post', req)
  if (deny) return deny
  const { id } = await ctx.params

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected object' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  type FieldSpec = { key: 'description' | 'glAccountOverride' | 'counterpartyGlOverride'; max: number }
  const FIELDS: FieldSpec[] = [
    { key: 'description', max: 4000 },
    { key: 'glAccountOverride', max: 64 },
    { key: 'counterpartyGlOverride', max: 64 },
  ]

  // Parse + validate each provided field. Distinguish "not in body" from "in body as null".
  type Parsed = { key: FieldSpec['key']; provided: boolean; value: string | null }
  const parsed: Parsed[] = []
  for (const { key, max } of FIELDS) {
    if (!(key in b)) {
      parsed.push({ key, provided: false, value: null })
      continue
    }
    const raw = b[key]
    if (raw === null) {
      parsed.push({ key, provided: true, value: null })
      continue
    }
    if (typeof raw !== 'string') {
      return NextResponse.json({ error: `${key} must be string or null` }, { status: 400 })
    }
    if (raw.length > max) {
      return NextResponse.json({ error: `${key} too long (max ${max})` }, { status: 400 })
    }
    parsed.push({ key, provided: true, value: raw })
  }

  if (!parsed.some(p => p.provided)) {
    return NextResponse.json({ error: 'no recognized fields provided' }, { status: 400 })
  }

  // Look up the tx to get the composite key
  const txRow = await db.select().from(transaction).where(eq(transaction.id, id)).limit(1)
  if (txRow.length === 0) {
    return NextResponse.json({ error: 'transaction not found' }, { status: 404 })
  }
  const t = txRow[0]
  const now = new Date()
  const updatedBy = user?.id ?? null

  // Build set fragment for UPDATE — only include provided fields. Always update audit columns.
  const setMap: Record<string, unknown> = { updatedAt: now, updatedBy }
  for (const p of parsed) {
    if (p.provided) setMap[p.key] = p.value
  }

  // Build insert values — provided fields use the value, non-provided default to null
  // (the row may not exist yet; insert needs every column we declared).
  const insertValues: Record<string, unknown> = {
    txHash: t.txHash,
    walletAddress: t.walletAddress,
    direction: t.direction,
    asset: t.asset,
    entityId: t.entityId,
    description: null,
    glAccountOverride: null,
    counterpartyGlOverride: null,
    updatedAt: now,
    updatedBy,
  }
  for (const p of parsed) {
    if (p.provided) insertValues[p.key] = p.value
  }

  await db.insert(txQbState)
    .values(insertValues as typeof txQbState.$inferInsert)
    .onConflictDoUpdate({
      target: [txQbState.txHash, txQbState.walletAddress, txQbState.direction, txQbState.asset],
      set: setMap,
    })

  logAudit({
    userId: updatedBy,
    action: 'tx_qb_state.update',
    resourceType: 'transaction',
    resourceId: id,
    metadata: { fields: parsed.filter(p => p.provided).map(p => p.key) },
  }).catch(() => { /* swallow */ })

  // Two-tier dirty marker (D3): material edits on a posted row flip status
  // to 'posted_modified'; description-only edits on a posted row are
  // silent (audit-only). Rows not yet linked to a qb_post (postId null)
  // are completely unaffected — the original PATCH semantics are preserved.
  const editedFields = parsed.filter(p => p.provided).map(p => p.key)
  const isMaterialEdit = editedFields.some(
    f => f === 'glAccountOverride' || f === 'counterpartyGlOverride',
  )
  const isDescriptionOnly = editedFields.length > 0 && !isMaterialEdit

  if (isMaterialEdit || isDescriptionOnly) {
    const [row] = await db
      .select({ postId: txQbState.postId, postingStatus: qbPost.postingStatus })
      .from(txQbState)
      .leftJoin(qbPost, eq(qbPost.id, txQbState.postId))
      .where(
        and(
          eq(txQbState.txHash, t.txHash),
          eq(txQbState.walletAddress, t.walletAddress),
          eq(txQbState.direction, t.direction),
          eq(txQbState.asset, t.asset),
        ),
      )
      .limit(1)

    if (row?.postId && row.postingStatus === 'posted') {
      if (isMaterialEdit) {
        // Idempotent: the postingStatus = 'posted' guard means a row already
        // in 'posted_modified' (or any non-posted state) is left untouched.
        await db
          .update(qbPost)
          .set({ postingStatus: 'posted_modified' })
          .where(and(eq(qbPost.id, row.postId), eq(qbPost.postingStatus, 'posted')))

        logAudit({
          userId: updatedBy,
          action: 'qb_post.marked_modified',
          resourceType: 'qb_post',
          resourceId: row.postId,
          metadata: { editedFields, txId: id },
        }).catch(() => { /* swallow */ })
      } else {
        // description-only — silent (no status flip), audit only
        const descField = parsed.find(p => p.key === 'description')
        logAudit({
          userId: updatedBy,
          action: 'qb_post.description_edited',
          resourceType: 'qb_post',
          resourceId: row.postId,
          metadata: { txId: id, newDescription: descField?.value ?? null },
        }).catch(() => { /* swallow */ })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
