import { db } from '@/lib/db'
import { wallet, token, balanceSnapshot } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { heliusRpc } from '@/lib/helius'
import { getSym } from '@/lib/constants'

/**
 * Fetch current SOL + token balances for a single wallet.
 * Returns a map of { SOL: n, ORCA: n, ... } — only tokens with positive amounts.
 */
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

/**
 * Cron: snapshot balances for every Orca-owned wallet that's not external.
 * Writes one row per (wallet, token) for today's UTC date.
 */
export async function fetchBalancesJob() {
  const wallets = await db.select().from(wallet).where(eq(wallet.isExternal, false))
  const tokens = await db.select({ symbol: token.symbol }).from(token)
  const tokenSet = new Set(tokens.map((t) => t.symbol))
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()

  const results: Record<string, unknown> = {}
  let succeeded = 0
  let failed = 0

  // Process in batches of 10 with a small delay to stay under Helius rate limit
  for (let i = 0; i < wallets.length; i += 10) {
    const batch = wallets.slice(i, i + 10)
    const batchResults = await Promise.allSettled(
      batch.map((w) => fetchWalletBalance(w.address).then((b) => ({ address: w.address, balances: b }))),
    )

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j]
      const addr = batch[j].address
      if (r.status === 'fulfilled') {
        const rows = Object.entries(r.value.balances)
          .filter(([sym]) => tokenSet.has(sym))
          .map(([sym, amt]) => ({
            date: today,
            walletAddress: r.value.address,
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
        results[addr] = { ok: true, tokens: rows.length }
        succeeded++
      } else {
        results[addr] = { ok: false, error: r.reason?.message ?? String(r.reason) }
        failed++
      }
    }

    if (i + 10 < wallets.length) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  return { ok: true, date: today, wallets: wallets.length, succeeded, failed, results }
}
