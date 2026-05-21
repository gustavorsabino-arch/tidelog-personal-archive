import { NextResponse } from 'next/server'
import { eq, asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, transaction } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'

export const maxDuration = 300

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

export async function POST(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const startedAt = Date.now()
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const { address } = await params

  // Look up the wallet
  const [walletRow] = await db.select().from(wallet).where(eq(wallet.address, address)).limit(1)
  if (!walletRow) {
    return NextResponse.json({ error: 'Wallet not found', code: 'admin.wallet_not_found' }, { status: 404 })
  }
  if (walletRow.chain !== 'SOL') {
    return NextResponse.json({ error: `Backfill not supported for ${walletRow.chain}`, code: 'admin.backfill_not_supported_for_chain' }, { status: 400 })
  }
  if (walletRow.isExternal) {
    return NextResponse.json({ error: 'Backfill not supported for external wallets', code: 'admin.backfill_external' }, { status: 400 })
  }

  // Look up oldest tx in DB for this wallet → use its txHash as the resume cursor
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

  let result
  try {
    result = await fetchTransactionsJob({ full: true, walletAddr: address, beforeSig })
  } catch (err) {
    console.error(`[admin-wallets][BACKFILL] job failed message=${(err as Error).message}`)
    return NextResponse.json({ ok: false, error: (err as Error).message, code: 'admin.backfill_failed' }, { status: 500 })
  }

  const elapsedMs = Date.now() - startedAt
  console.info(`[admin-wallets][BACKFILL] done duration=${elapsedMs}ms`)
  return NextResponse.json({ ok: true, ...result })
}
