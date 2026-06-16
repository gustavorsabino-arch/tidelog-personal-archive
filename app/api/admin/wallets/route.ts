import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, entity } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { CreateWalletSchema, normalizeAddress } from '@/lib/admin/wallet-validation'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'
import { accountNumberExists } from '@/lib/qb/cache-reads'

export const maxDuration = 300

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

export async function GET(req: Request) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const [wallets, entities] = await Promise.all([
    db.select().from(wallet).orderBy(wallet.createdAt),
    db.select({ id: entity.id, name: entity.name, isActive: entity.isActive }).from(entity).orderBy(entity.name),
  ])
  return NextResponse.json({ wallets, entities })
}

export async function POST(req: Request) {
  const startedAt = Date.now()
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  let parsed: ReturnType<typeof CreateWalletSchema.safeParse>
  try {
    const json = await req.json()
    parsed = CreateWalletSchema.safeParse(json)
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'validation.failed' }, { status: 400 })
  }
  if (!parsed.success) {
    console.warn(`[admin-wallets][POST] zod failed`, parsed.error.issues)
    return NextResponse.json({ error: 'Validation failed', code: 'validation.failed', details: parsed.error.issues }, { status: 400 })
  }
  const input = parsed.data
  const address = normalizeAddress(input.chain, input.address)

  console.info(`[admin-wallets][POST] start byEmail=${user.email} chain=${input.chain} address=${shortAddr(address)}`)

  // Verify entity exists
  const [ent] = await db.select({ id: entity.id }).from(entity).where(eq(entity.id, input.entityId)).limit(1)
  if (!ent) {
    console.warn(`[admin-wallets][POST] entity not found entityId=${input.entityId}`)
    return NextResponse.json({ error: 'Entity not found', code: 'admin.entity_not_found' }, { status: 400 })
  }

  // Check duplicate
  const [existing] = await db.select({ address: wallet.address }).from(wallet).where(eq(wallet.address, address)).limit(1)
  if (existing) {
    console.warn(`[admin-wallets][POST] address exists address=${shortAddr(address)}`)
    return NextResponse.json({ error: 'Wallet already exists', code: 'admin.address_conflict' }, { status: 409 })
  }

  const isInternal = (input.type ?? 'internal') === 'internal'
  const isHidden = input.hiddenFromFinance ?? false
  // Every new internal-non-hidden wallet needs a backfill until the cron or
  // inline backfill below clears the flag.
  const needsBackfill = isInternal && !isHidden

  // Insert
  try {
    await db.insert(wallet).values({
      address,
      label: input.label,
      chain: input.chain,
      entityId: input.entityId,
      accountCode: input.accountCode,
      qbVendorName: input.qbVendorName ?? null,
      qbClassName: input.qbClassName ?? null,
      type: input.type ?? 'internal',
      hiddenFromFinance: input.hiddenFromFinance ?? false,
      needsBackfill: needsBackfill,
    })
  } catch (err) {
    console.error(`[admin-wallets][POST] db insert failed message=${(err as Error).message}`)
    return NextResponse.json({ error: 'Insert failed', code: 'admin.insert_failed' }, { status: 500 })
  }
  console.info(`[admin-wallets][POST] inserted address=${address} entity=${input.entityId} type=${input.type ?? 'internal'} hidden=${isHidden}`)

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'wallet.created',
    resourceType: 'wallet',
    resourceId: address,
    metadata: { label: input.label, chain: input.chain, entityId: input.entityId, type: input.type ?? 'internal', hiddenFromFinance: isHidden, needsBackfill, byEmail: user.email },
  })

  // Optional backfill kickoff (SOL non-external only)
  let backfillResult: unknown = undefined
  const shouldBackfill = input.backfill !== false && input.chain === 'SOL' && isInternal && !isHidden
  if (shouldBackfill) {
    console.info(`[admin-wallets][POST] backfill kickoff mode=full beforeSig=none`)
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'wallet.backfill.triggered',
      resourceType: 'wallet',
      resourceId: address,
      metadata: { mode: 'full', beforeSig: null, byEmail: user.email },
    })
    try {
      backfillResult = await fetchTransactionsJob({ full: true, walletAddr: address })
    } catch (err) {
      const errMsg = (err as Error).message
      console.error(`[admin-wallets][POST] backfill failed message=${errMsg}`)
      // Audit the failure so the trail isn't an orphaned 'triggered' with no outcome.
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'wallet.backfill.failed',
        resourceType: 'wallet',
        resourceId: address,
        metadata: { mode: 'full', beforeSig: null, error: errMsg, byEmail: user.email },
      })
      backfillResult = { ok: false, error: errMsg }
    }
  } else {
    const reason = input.chain !== 'SOL'
      ? 'not-sol'
      : !isInternal
      ? 'external'
      : isHidden
      ? 'hidden'
      : 'opt-out'
    console.info(`[admin-wallets][POST] backfill skipped reason=${reason}`)
  }

  const elapsedMs = Date.now() - startedAt
  console.info(`[admin-wallets][POST] done duration=${elapsedMs}ms outcome=success`)

  const responseBody: Record<string, unknown> = {
    wallet: {
      address,
      label: input.label,
      chain: input.chain,
      entityId: input.entityId,
      accountCode: input.accountCode,
      type: input.type ?? 'internal',
      hiddenFromFinance: isHidden,
      needsBackfill,
    },
  }
  if (backfillResult !== undefined) {
    responseBody.backfill = backfillResult
  }

  // Soft-validate accountCode against QB catalog — warn but do not block.
  if (input.accountCode) {
    const codeExists = await accountNumberExists(input.entityId, input.accountCode)
    if (!codeExists) {
      responseBody.warning = 'account_code not found in QuickBooks chart of accounts'
    }
  }

  return NextResponse.json(responseBody, { status: 201 })
}
