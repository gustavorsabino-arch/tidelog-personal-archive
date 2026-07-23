import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { wallet, balanceSnapshot } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/admin/seed-manual-balances
 *
 * One-shot admin endpoint that upserts the manually-tracked off-chain
 * positions (Strategic Reserve - Morpho, Altitude Treasury) into the
 * Overview Stablecoins view.
 *
 * These wallets use chain='MANUAL' — the balance cron (lib/cron/fetch-balances.ts:34)
 * dispatches only SOL/ETH/BTC, so 'MANUAL' rows are never overwritten.
 * The Overview picks them up because lib/overview.ts:shouldIncludeInOverview
 * only filters on type='internal' AND !hiddenFromFinance.
 *
 * Idempotent — safe to re-run. Updates label + amount to whatever is
 * hardcoded here; edit this file and re-deploy to change values.
 *
 * Auth: admin:manage_data. Just open the URL as admin — that's it.
 */

type ManualPosition = {
  address: string
  label: string
  entityId: string          // lowercase — 'opco' / 'foundation' / 'zagreus'
  accountCode: string | null
  token: string             // must exist in app.token
  amount: number
}

const POSITIONS: ManualPosition[] = [
  {
    address: '0x54B3Ac176ed8c57367B7B7528600D4CFFbbE0De3',
    label: 'Strategic Reserve - Morpho',
    entityId: 'opco',
    accountCode: '113603',
    token: 'USDC',
    amount: 3_900_025.59,
  },
  {
    address: '2s4hhgQGPuBsEnvrVtT3n2PYXSvHFWXgmTK1sTM9Rqas',
    label: 'Altitude Treasury',
    entityId: 'opco',
    accountCode: null,
    token: 'USDC',
    amount: 5_260_195.93,
  },
]

export async function GET(req: Request) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const seeded: Array<{ address: string; label: string; token: string; amount: number }> = []

  for (const p of POSITIONS) {
    await db.insert(wallet).values({
      address: p.address,
      label: p.label,
      chain: 'MANUAL',
      entityId: p.entityId,
      accountCode: p.accountCode ?? null,
      type: 'internal',
      hiddenFromFinance: false,
    }).onConflictDoUpdate({
      target: wallet.address,
      set: {
        label: p.label,
        chain: 'MANUAL',
        entityId: p.entityId,
        accountCode: p.accountCode ?? null,
        type: 'internal',
        hiddenFromFinance: false,
        updatedAt: now,
      },
    })

    await db.insert(balanceSnapshot).values({
      date: today,
      walletAddress: p.address,
      token: p.token,
      amount: String(p.amount),
      fetchedAt: now,
    }).onConflictDoUpdate({
      target: [balanceSnapshot.date, balanceSnapshot.walletAddress, balanceSnapshot.token],
      set: { amount: String(p.amount), fetchedAt: now },
    })

    seeded.push({ address: p.address, label: p.label, token: p.token, amount: p.amount })
  }

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'admin.seed_manual_balances',
    resourceType: 'wallet',
    resourceId: 'manual-positions',
    metadata: { date: today, positions: seeded },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    date: today,
    seeded,
    note: 'Refresh Overview (/) to see the values. Wallets use chain=MANUAL so cron will not overwrite.',
  })
}
