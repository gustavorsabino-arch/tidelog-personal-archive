import { db } from '@/lib/db'
import { token, balanceSnapshot } from '@/lib/db/schema'
import { heliusRpc } from '@/lib/helius'
import { getSym } from '@/lib/constants'

export type WalletRow = {
  address: string
  chain: string
  entityId: string
  isExternal: boolean
}

export type FetchBalancesResult = {
  succeeded: number
  failed: number
  skipped?: number
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr
}

async function fetchWalletBalance(address: string): Promise<Record<string, number>> {
  const balances: Record<string, number> = { SOL: 0 }

  const [balRes, tokRes] = await Promise.all([
    heliusRpc('getBalance', [address]),
    heliusRpc('getTokenAccountsByOwner', [
      address,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ]),
  ])

  balances.SOL = (balRes?.result?.value || 0) / 1e9

  for (const acc of (tokRes?.result?.value || [])) {
    const info = acc.account?.data?.parsed?.info
    if (!info) continue
    const sym = getSym(info.mint)
    const amt = parseFloat(info.tokenAmount?.uiAmountString || '0')
    if (sym && amt > 0) {
      balances[sym] = (balances[sym] || 0) + amt
    }
  }

  return balances
}

export async function fetchSolBalances(wallets: WalletRow[]): Promise<FetchBalancesResult> {
  if (wallets.length === 0) return { succeeded: 0, failed: 0 }

  const tokens = await db.select({ symbol: token.symbol }).from(token)
  const tokenSet = new Set(tokens.map((t) => t.symbol))
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()

  let succeeded = 0
  let failed = 0

  for (let i = 0; i < wallets.length; i += 10) {
    const batch = wallets.slice(i, i + 10)
    const batchResults = await Promise.allSettled(
      batch.map((w) => fetchWalletBalance(w.address).then((b) => ({ address: w.address, balances: b }))),
    )

    for (const r of batchResults) {
      if (r.status === 'rejected') {
        console.error(`[fetch-balances][SOL] failed message=${(r.reason as Error)?.message ?? 'unknown'}`)
        failed++
        continue
      }

      const { address, balances } = r.value
      const rows = Object.entries(balances)
        .filter(([sym, amt]) => tokenSet.has(sym) && amt > 0)
        .map(([sym, amt]) => ({
          date: today,
          walletAddress: address,
          token: sym,
          amount: String(amt),
          fetchedAt: now,
        }))

      if (rows.length > 0) {
        // Upsert one row at a time so each token's amount updates correctly
        for (const row of rows) {
          await db.insert(balanceSnapshot).values(row).onConflictDoUpdate({
            target: [balanceSnapshot.date, balanceSnapshot.walletAddress, balanceSnapshot.token],
            set: { amount: row.amount, fetchedAt: now },
          })
        }
      }

      console.info(
        `[fetch-balances][SOL] ${shortAddr(address)} balance SOL=${balances.SOL ?? 0} tokens=${Object.keys(balances).length - 1}`,
      )
      succeeded++
    }

    if (i + 10 < wallets.length) await new Promise((r) => setTimeout(r, 200))
  }

  return { succeeded, failed }
}
