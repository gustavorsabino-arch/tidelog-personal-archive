/**
 * One-shot seed of manually-tracked positions into Overview Stablecoins.
 *
 * Uses chain='MANUAL' — cron skips because it's not in the SOL/ETH/BTC
 * dispatch map (lib/cron/fetch-balances.ts:34), so the balance_snapshot
 * row we insert here persists forever until re-run.
 *
 * Overview picks it up because lib/overview.ts:shouldIncludeInOverview
 * only filters on type='internal' + !hiddenFromFinance — chain is not
 * checked.
 *
 * Idempotent: re-runs update the wallet metadata + refresh the snapshot
 * amount for today.
 *
 * Run:  bun scripts/seed-manual-balances.ts
 */
import { db } from '@/lib/db'
import { wallet, balanceSnapshot } from '@/lib/db/schema'

type ManualPosition = {
  address: string
  label: string
  entityId: string            // lowercase — 'opco' / 'foundation' / 'zagreus'
  accountCode: string | null
  token: string               // 'USDC' etc — must exist in app.token
  amount: number              // human-readable, e.g. 3900025.59
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
    accountCode: null,        // TODO: substitui pelo GL account do Altitude se quiseres
    token: 'USDC',
    amount: 5_260_195.93,
  },
]

async function main() {
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()

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

    console.log(`✓ seeded ${p.label}  ${p.token} ${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  }

  console.log(`\nDone. ${POSITIONS.length} positions seeded for ${today}.`)
  console.log('Estas wallets tem chain=MANUAL — o balance cron nunca as toca.')
  console.log('Re-corre este script quando o valor manual mudar.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
