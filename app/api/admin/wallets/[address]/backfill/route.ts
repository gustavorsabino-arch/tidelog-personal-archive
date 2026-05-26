import { NextResponse } from 'next/server'
import { eq, asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, transaction } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'
import { fetchBalancesJob } from '@/lib/cron/fetch-balances'

export const maxDuration = 300

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

export async function POST(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const startedAt = Date.now()
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const { address } = await params

  const [walletRow] = await db.select().from(wallet).where(eq(wallet.address, address)).limit(1)
  if (!walletRow) {
    return NextResponse.json({ error: 'Wallet not found', code: 'admin.wallet_not_found' }, { status: 404 })
  }
  if (walletRow.chain !== 'SOL') {
    return NextResponse.json({ error: `Backfill not supported for ${walletRow.chain}`, code: 'admin.backfill_not_supported_for_chain' }, { status: 400 })
  }
  if (walletRow.type === 'external') {
    return NextResponse.json({ error: 'Backfill not supported for external wallets', code: 'admin.backfill_external' }, { status: 400 })
  }
  if (walletRow.hiddenFromFinance === true) {
    return NextResponse.json({ error: 'Backfill not supported for hidden wallets (un-hide first)', code: 'admin.backfill_hidden' }, { status: 400 })
  }

  // Resume cursor: oldest tx in DB → fetch only older txs from chain.
  const [oldest] = await db
    .select({ txHash: transaction.txHash, blockTime: transaction.blockTime })
    .from(transaction)
    .where(eq(transaction.walletAddress, address))
    .orderBy(asc(transaction.blockTime))
    .limit(1)
  const beforeSig: string | undefined = oldest?.txHash
  const mode = beforeSig ? 'resume' : 'full'

  console.info(`[admin-wallets][BACKFILL] start byEmail=${user.email} address=${shortAddr(address)} mode=${mode} beforeSig=${beforeSig?.slice(0, 8) ?? 'none'}…`)

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'wallet.backfill.triggered',
    resourceType: 'wallet',
    resourceId: address,
    metadata: { mode, beforeSig: beforeSig ?? null, byEmail: user.email },
  })

  let txResult
  try {
    txResult = await fetchTransactionsJob({ full: true, walletAddr: address, beforeSig })
  } catch (err) {
    const errMsg = (err as Error).message
    console.error(`[admin-wallets][BACKFILL] tx job failed message=${errMsg}`)
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'wallet.backfill.failed',
      resourceType: 'wallet',
      resourceId: address,
      metadata: { mode, stage: 'transactions', error: errMsg, byEmail: user.email },
    })
    return NextResponse.json({ ok: false, error: errMsg, code: 'admin.backfill_failed' }, { status: 500 })
  }

  let balResult
  try {
    balResult = await fetchBalancesJob({ walletAddr: address })
  } catch (err) {
    const errMsg = (err as Error).message
    console.error(`[admin-wallets][BACKFILL] balance job failed message=${errMsg}`)
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'wallet.backfill.failed',
      resourceType: 'wallet',
      resourceId: address,
      metadata: { mode, stage: 'balances', error: errMsg, byEmail: user.email },
    })
    return NextResponse.json({ ok: false, error: errMsg, code: 'admin.backfill_failed' }, { status: 500 })
  }

  // Both succeeded — clear the flag and stamp completion.
  await db.update(wallet)
    .set({ needsBackfill: false, lastFullBackfillAt: new Date(), updatedAt: new Date() })
    .where(eq(wallet.address, address))

  const elapsedMs = Date.now() - startedAt
  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'wallet.backfill.completed',
    resourceType: 'wallet',
    resourceId: address,
    metadata: { mode, durationMs: elapsedMs, txResult, balResult, byEmail: user.email },
  })
  console.info(`[admin-wallets][BACKFILL] done duration=${elapsedMs}ms`)
  return NextResponse.json({ ...txResult, balances: balResult, durationMs: elapsedMs })
}
