import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'

/**
 * GET /api/admin/refetch-wallet/[address]
 *
 * Runs the incremental fetchTransactionsJob for a single wallet — picks up
 * every on-chain transaction newer than the most recent one already in the
 * DB. Solves the "tidelog stopped at July 22 but Solscan has txns through
 * July 30" class of gap: usually the periodic cron missed a run (Vercel
 * timeout / Helius transient) and never caught up on its own.
 *
 * Runs synchronously; typical single-wallet incremental pass is under 30s.
 * If it exceeds Vercel's default 60s (Pro plan) we bump maxDuration.
 *
 * Auth: admin:manage_data. Same gate as /api/admin/wallets/[address]/backfill
 * so only ops can trigger network + Helius load.
 *
 * Response:
 *   { ok: true, walletAddr, inserted, mode, elapsedMs, result }
 * Or:
 *   { ok: false, error }
 */
export const maxDuration = 120

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const { address } = await params
  if (!address || address.length < 20) {
    return NextResponse.json({ error: 'Missing or invalid address', code: 'admin.bad_address' }, { status: 400 })
  }

  const startedAt = Date.now()
  try {
    const result = await fetchTransactionsJob({ walletAddr: address })
    const walletResult = result.results?.[address]
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: result.ok ? 'admin.refetch_wallet.succeeded' : 'admin.refetch_wallet.partial',
      resourceType: 'wallet',
      resourceId: address,
      metadata: {
        byEmail: user.email,
        durationMs: Date.now() - startedAt,
        inserted: result.inserted,
        mode: result.mode,
        walletResult,
      },
    }).catch(() => {})

    return NextResponse.json({
      ok: result.ok,
      walletAddr: address,
      inserted: result.inserted,
      mode: result.mode,
      elapsedMs: result.elapsedMs,
      result: walletResult ?? null,
      gains: result.gains,
    })
  } catch (err) {
    const message = (err as Error).message
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'admin.refetch_wallet.failed',
      resourceType: 'wallet',
      resourceId: address,
      metadata: {
        byEmail: user.email,
        durationMs: Date.now() - startedAt,
        error: message,
      },
    }).catch(() => {})
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
