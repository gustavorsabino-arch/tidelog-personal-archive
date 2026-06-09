import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { walletTokenAccountCode, wallet, transaction } from '@/lib/db/schema'
import { logAudit } from '@/lib/audit'
import { accountNumberExists } from '@/lib/qb/cache-reads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ address: string }> }

// GET /api/wallets/[address]/token-gl
//   Returns existing per-token GL mappings for this wallet plus the set of
//   token symbols that appear in this wallet's transaction history.
//   Response: { mappings: { tokenSymbol, accountCode }[], transactedTokens: string[] }
export async function GET(req: NextRequest, ctx: Ctx) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  const { address } = await ctx.params

  const [mappings, tokenRows] = await Promise.all([
    db
      .select({ tokenSymbol: walletTokenAccountCode.tokenSymbol, accountCode: walletTokenAccountCode.accountCode })
      .from(walletTokenAccountCode)
      .where(eq(walletTokenAccountCode.walletAddress, address)),
    db
      .selectDistinct({ asset: transaction.asset })
      .from(transaction)
      .where(eq(transaction.walletAddress, address)),
  ])

  return NextResponse.json({
    mappings,
    transactedTokens: tokenRows.map((r) => r.asset),
  })
}

// PUT /api/wallets/[address]/token-gl
//   Body: { tokenSymbol: string, accountCode: string }
//   Upserts a per-token GL mapping. Soft-warns if the account code is not found
//   in the QB chart of accounts but does NOT block the upsert.
export async function PUT(req: NextRequest, ctx: Ctx) {
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

  if (typeof b.tokenSymbol !== 'string' || b.tokenSymbol.trim().length === 0) {
    return NextResponse.json({ error: 'tokenSymbol must be a non-empty string' }, { status: 400 })
  }
  if (typeof b.accountCode !== 'string' || b.accountCode.trim().length === 0) {
    return NextResponse.json({ error: 'accountCode must be a non-empty string' }, { status: 400 })
  }
  if (b.accountCode.length > 80) {
    return NextResponse.json({ error: 'accountCode must be 80 chars or fewer' }, { status: 400 })
  }

  const tokenSymbol = b.tokenSymbol as string
  const accountCode = b.accountCode as string

  const [existing] = await db.select({ entityId: wallet.entityId }).from(wallet).where(eq(wallet.address, address)).limit(1)
  if (!existing) {
    return NextResponse.json({ error: 'wallet not found' }, { status: 404 })
  }

  await db
    .insert(walletTokenAccountCode)
    .values({ walletAddress: address, tokenSymbol, accountCode, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [walletTokenAccountCode.walletAddress, walletTokenAccountCode.tokenSymbol],
      set: { accountCode, updatedAt: new Date() },
    })

  const exists = await accountNumberExists(existing.entityId, accountCode)

  logAudit({
    userId: user?.id ?? null,
    action: 'wallet.token_gl.update',
    resourceType: 'wallet',
    resourceId: address,
    metadata: { tokenSymbol, accountCode },
  }).catch(() => { /* swallow */ })

  const resp: Record<string, unknown> = { ok: true }
  if (!exists) {
    resp.warning = 'account_code not found in QuickBooks chart of accounts'
  }
  return NextResponse.json(resp)
}

// DELETE /api/wallets/[address]/token-gl
//   Body: { tokenSymbol: string }
//   Removes the per-token GL mapping for the given token.
export async function DELETE(req: NextRequest, ctx: Ctx) {
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

  if (typeof b.tokenSymbol !== 'string' || b.tokenSymbol.trim().length === 0) {
    return NextResponse.json({ error: 'tokenSymbol must be a non-empty string' }, { status: 400 })
  }

  const tokenSymbol = b.tokenSymbol as string

  await db
    .delete(walletTokenAccountCode)
    .where(and(
      eq(walletTokenAccountCode.walletAddress, address),
      eq(walletTokenAccountCode.tokenSymbol, tokenSymbol),
    ))

  logAudit({
    userId: user?.id ?? null,
    action: 'wallet.token_gl.delete',
    resourceType: 'wallet',
    resourceId: address,
    metadata: { tokenSymbol },
  }).catch(() => { /* swallow */ })

  return NextResponse.json({ ok: true })
}
