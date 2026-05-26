import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, transaction, balanceSnapshot } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { recomputeEntityGains } from '@/lib/orca-gains-writer'
import { toDisplayEntity } from '@/lib/entity'

export const maxDuration = 60

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

export async function DELETE(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const startedAt = Date.now()
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const { address } = await params

  const [walletRow] = await db.select().from(wallet).where(eq(wallet.address, address)).limit(1)
  if (!walletRow) {
    return NextResponse.json({ error: 'Wallet not found', code: 'admin.wallet_not_found' }, { status: 404 })
  }

  console.info(`[admin-wallets][DELETE] start byEmail=${user.email} address=${shortAddr(address)} chain=${walletRow.chain} entity=${walletRow.entityId}`)

  let txCount = 0
  let snapCount = 0
  try {
    // Atomic cascade: if the wallet delete fails after txs/snapshots are gone,
    // the transaction rolls back so we don't leave orphaned data.
    const counts = await db.transaction(async (tx) => {
      const txs = await tx.delete(transaction).where(eq(transaction.walletAddress, address)).returning({ txHash: transaction.txHash })
      const snaps = await tx.delete(balanceSnapshot).where(eq(balanceSnapshot.walletAddress, address)).returning({ date: balanceSnapshot.date })
      await tx.delete(wallet).where(eq(wallet.address, address))
      return { txCount: txs.length, snapCount: snaps.length }
    })
    txCount = counts.txCount
    snapCount = counts.snapCount
  } catch (err) {
    console.error(`[admin-wallets][DELETE] cascade failed message=${(err as Error).message}`)
    return NextResponse.json({ ok: false, error: (err as Error).message, code: 'admin.delete_failed' }, { status: 500 })
  }

  console.info(`[admin-wallets][DELETE] deleted wallet + ${txCount} transactions + ${snapCount} snapshots`)

  // Recompute gains if this wallet had transactions (otherwise nothing to refresh)
  let gainsRecomputed: { entity: string; error?: string } | null = null
  if (txCount > 0) {
    const displayEntity = toDisplayEntity(walletRow.entityId)
    try {
      await recomputeEntityGains(displayEntity)
      gainsRecomputed = { entity: displayEntity }
      console.info(`[admin-wallets][DELETE] gains recomputed for entity=${displayEntity}`)
    } catch (err) {
      gainsRecomputed = { entity: displayEntity, error: (err as Error).message }
      console.error(`[admin-wallets][DELETE] gains recompute failed entity=${displayEntity} message=${(err as Error).message}`)
    }
  }

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'wallet.deleted',
    resourceType: 'wallet',
    resourceId: address,
    metadata: {
      label: walletRow.label,
      chain: walletRow.chain,
      entityId: walletRow.entityId,
      type: walletRow.type,
      deletedTxCount: txCount,
      deletedSnapshotCount: snapCount,
      gainsRecomputed,
      byEmail: user.email,
    },
  })

  const elapsedMs = Date.now() - startedAt
  console.info(`[admin-wallets][DELETE] done duration=${elapsedMs}ms`)

  return NextResponse.json({
    ok: true,
    deletedAddress: address,
    deletedTxCount: txCount,
    deletedSnapshotCount: snapCount,
    gainsRecomputed,
  })
}
