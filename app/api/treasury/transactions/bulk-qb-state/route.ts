import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { transaction, txQbState, qbPost } from '@/lib/db/schema'
import { effectiveInternalPostId } from '@/lib/qb/internal-transfer'
import { logAudit } from '@/lib/audit'
import { findVendorDefaults } from '@/lib/vendors/defaults'

const MAX_BULK = 1000
export const maxDuration = 300

// PATCH /api/treasury/transactions/bulk-qb-state
//   Body: { txIds: string[], glAccountOverride?: string|null,
//           counterpartyGlOverride?: string|null,
//           vendorOverride?: string|null, classOverride?: string|null }
//   - txIds: non-empty array of transaction.id UUIDs, max 1000
//   - At least one override field must be present
//   - Fields NOT present in body are left untouched (only-update-provided)
//   - Fields present and set to null clear that field on the row
//   - Per-tx overrides ONLY: no counterparty-map upsert, no wallet
//     memorization — this is the "surgical exception for this month" path
//     (the single-cell editors are the ones that memorize defaults)
//
// For each txId: upserts tx_qb_state with the provided overrides and flips
// any linked posted qb_post to 'posted_modified' (same material-edit semantics
// as the single-tx route).
//
// Returns { updated: number, skipped: number } where skipped = txIds not found.
export async function PATCH(req: NextRequest) {
  const { user, deny } = await requirePermission('qb:post', req)
  if (deny) return deny

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected object' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  // Validate txIds
  if (!Array.isArray(b.txIds) || b.txIds.length === 0) {
    return NextResponse.json({ error: 'txIds must be a non-empty array' }, { status: 400 })
  }
  if (b.txIds.length > MAX_BULK) {
    return NextResponse.json({ error: `txIds exceeds max of ${MAX_BULK}` }, { status: 400 })
  }
  const txIds = b.txIds as unknown[]
  if (!txIds.every(id => typeof id === 'string')) {
    return NextResponse.json({ error: 'txIds must be strings' }, { status: 400 })
  }
  const txIdList = txIds as string[]

  // Validate override fields — same rules as the single route
  type OverrideKey = 'glAccountOverride' | 'counterpartyGlOverride' | 'vendorOverride' | 'classOverride'
  const OVERRIDE_FIELDS: { key: OverrideKey; max: number }[] = [
    { key: 'glAccountOverride', max: 64 },
    { key: 'counterpartyGlOverride', max: 64 },
    { key: 'vendorOverride', max: 256 },
    { key: 'classOverride', max: 256 },
  ]

  type Parsed = { key: OverrideKey; provided: boolean; value: string | null }
  const parsed: Parsed[] = []
  for (const { key, max } of OVERRIDE_FIELDS) {
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
    return NextResponse.json({ error: 'at least one override field must be provided' }, { status: 400 })
  }

  const providedFields = parsed.filter(p => p.provided)
  const selectedVendor = parsed.find(p => p.key === 'vendorOverride' && p.provided)?.value
  const vendorDefaults = selectedVendor ? await findVendorDefaults(selectedVendor) : null
  const hasClassOverride = providedFields.some(p => p.key === 'classOverride')
  const hasCounterpartyOverride = providedFields.some(p => p.key === 'counterpartyGlOverride')

  // Fetch all requested transactions in one query
  const txRows = await db
    .select()
    .from(transaction)
    .where(inArray(transaction.id, txIdList))

  const foundIds = new Set(txRows.map(r => r.id))
  const skipped = txIdList.filter(id => !foundIds.has(id)).length
  const now = new Date()
  const updatedBy = user?.id ?? null

  if (txRows.length === 0) {
    return NextResponse.json({ updated: 0, skipped })
  }

  const foundTxIds = txRows.map(r => r.id)
  const providedFieldKeys = providedFields.map(p => p.key)
  let flippedCount = 0

  // Wrap all per-row writes in a single transaction so the bulk op is all-or-nothing
  await db.transaction(async (tx) => {
    for (const t of txRows) {
      // Build upsert — same pattern as single route
      const setMap: Record<string, unknown> = { updatedAt: now, updatedBy }
      for (const p of providedFields) {
        setMap[p.key] = p.value
      }
      if (vendorDefaults) {
        if (!hasClassOverride && vendorDefaults.className) setMap.classOverride = vendorDefaults.className
        if (t.counterparty && !hasCounterpartyOverride) setMap.counterpartyGlOverride = vendorDefaults.glAccount
      }

      const insertValues: Record<string, unknown> = {
        txHash: t.txHash,
        walletAddress: t.walletAddress,
        direction: t.direction,
        asset: t.asset,
        entityId: t.entityId,
        description: null,
        glAccountOverride: null,
        counterpartyGlOverride: null,
        vendorOverride: null,
        classOverride: null,
        updatedAt: now,
        updatedBy,
      }
      for (const p of providedFields) {
        insertValues[p.key] = p.value
      }
      if (vendorDefaults) {
        if ('classOverride' in setMap) insertValues.classOverride = setMap.classOverride
        if ('counterpartyGlOverride' in setMap) insertValues.counterpartyGlOverride = setMap.counterpartyGlOverride
      }

      await tx.insert(txQbState)
        .values(insertValues as typeof txQbState.$inferInsert)
        .onConflictDoUpdate({
          target: [txQbState.txHash, txQbState.walletAddress, txQbState.direction, txQbState.asset],
          set: setMap,
        })

      // Material edit: flip any linked posted qb_post to posted_modified
      // vendorOverride + classOverride are always material (same rule as single route)
      const [row] = await tx
        .select({ postId: qbPost.id, postingStatus: qbPost.postingStatus })
        .from(transaction)
        .leftJoin(qbPost, eq(qbPost.id, effectiveInternalPostId()))
        .where(eq(transaction.id, t.id))
        .limit(1)

      if (row?.postId && row.postingStatus === 'posted') {
        await tx
          .update(qbPost)
          .set({ postingStatus: 'posted_modified' })
          .where(and(eq(qbPost.id, row.postId), eq(qbPost.postingStatus, 'posted')))
        flippedCount++
      }
    }
  })

  logAudit({
    userId: user?.id ?? null,
    action: 'tx_qb_state.bulk_update',
    resourceType: 'transaction',
    metadata: { fields: providedFieldKeys, vendorDefaultsApplied: !!vendorDefaults, vendorMappingMissing: !!selectedVendor && !vendorDefaults, txIds: foundTxIds, updated: foundTxIds.length, flipped: flippedCount },
  }).catch(() => { /* swallow */ })

  return NextResponse.json({ updated: txRows.length, skipped, vendorDefaults, vendorMappingMissing: !!selectedVendor && !vendorDefaults })
}
