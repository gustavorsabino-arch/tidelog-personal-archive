import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { wallet, balanceSnapshot, token } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/admin/seed-manual-balances
 *
 * One-shot admin endpoint that upserts manually-tracked off-chain positions
 * (Morpho ETH, Altitude Solana, Mercury bank accounts) so they surface in
 * the Overview cards. Two mechanisms working together:
 *
 *   1. Wallets use chain='MANUAL' — the balance cron dispatches only
 *      SOL/ETH/BTC (lib/cron/fetch-balances.ts:34), so 'MANUAL' rows are
 *      never overwritten by scheduled fetches.
 *   2. Bank accounts use token='USD'. The USD token row is upserted here
 *      so the balance_snapshot FK holds. USD is in STABLE_TOKENS (1:1
 *      pricing) but also in BANK_TOKENS (UI puts it in its own "Bank" card
 *      instead of aggregating into "Stablecoins").
 *
 * Idempotent — safe to re-run. Updates label + amount to whatever is
 * hardcoded here; edit the POSITIONS array + re-deploy to change values.
 *
 * Auth: admin:manage_data. Just open the URL as admin — that's it.
 */

type ManualPosition = {
  address: string
  label: string
  entityId: string          // lowercase — 'opco' / 'foundation' / 'zagreus'
  accountCode: string | null
  token: string             // 'USDC' | 'USD' (bank) — must exist in app.token
  amount: number
}

const POSITIONS: ManualPosition[] = [
  // === Stablecoins bucket (on-chain positions we track manually) ===
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
    label: 'Altitude OpCo - Earn Vault',
    entityId: 'opco',
    accountCode: null,
    token: 'USDC',
    amount: 5_327_509.32,        // 5,260,195.93 + 67,313.39 (on-chain wallet USDC)
  },
  {
    // Synthetic address — user didn't supply a real Solana one for the
    // Zagreus Altitude position. Swap for a real address later if needed.
    address: 'altitude-treasury-zagreus',
    label: 'Altitude Zagreus - Earn Vault',
    entityId: 'zagreus',
    accountCode: null,
    token: 'USDC',
    amount: 5_052_444.84,
  },

  // === Bank bucket (Mercury USD accounts) ===
  {
    address: 'mercury-foundation-checking-2592',
    label: 'Mercury Foundation Checking 2592',
    entityId: 'foundation',
    accountCode: null,
    token: 'USD',
    amount: 44_908.15,
  },
  {
    address: 'mercury-zagreus-checking-0627',
    label: 'Mercury Zagreus Checking 0627',
    entityId: 'zagreus',
    accountCode: null,
    token: 'USD',
    amount: 64_467.77,
  },
  {
    address: 'mercury-zagreus-treasury',
    label: 'Mercury Zagreus Treasury',
    entityId: 'zagreus',
    accountCode: null,
    token: 'USD',
    amount: 449_008.21,
  },
]

export async function GET(req: Request) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const seeded: Array<{ address: string; label: string; token: string; amount: number }> = []

  // Ensure every token symbol referenced below exists in app.token before
  // we try to insert balance_snapshot rows (FK constraint). USD is the new
  // one — the SOL-side stablecoins (USDC etc.) already have rows from seed.
  const tokensNeeded = Array.from(new Set(POSITIONS.map(p => p.token)))
  for (const sym of tokensNeeded) {
    await db.insert(token).values({
      symbol: sym,
      name: sym === 'USD' ? 'US Dollar (Bank)' : sym,
      decimals: sym === 'USD' ? 2 : 6,
      coinId: null,
    }).onConflictDoNothing({ target: token.symbol })
  }

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
