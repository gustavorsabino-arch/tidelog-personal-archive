// lib/cron/fetch-balances.ts
import { db } from '@/lib/db'
import { wallet } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { fetchSolBalances, type WalletRow, type FetchBalancesResult } from './balances/sol'
import { fetchEthBalances } from './balances/eth'
import { fetchBtcBalances } from './balances/btc'

export async function fetchBalancesJob(): Promise<FetchBalancesResult & { ok: true; mode: 'dispatched' }> {
  const startedAt = Date.now()
  const rows = await db.select().from(wallet).where(eq(wallet.isExternal, false))
  const wallets: WalletRow[] = rows.map((w) => ({
    address: w.address, chain: w.chain, entityId: w.entityId, isExternal: w.isExternal,
  }))
  console.info(`[fetch-balances] start walletCount=${wallets.length}`)

  const byChain: Record<string, WalletRow[]> = { SOL: [], ETH: [], BTC: [] }
  for (const w of wallets) {
    if (w.chain in byChain) byChain[w.chain].push(w)
    else console.warn(`[fetch-balances] unknown chain skipped chain=${w.chain} address=${w.address}`)
  }

  const sol = await fetchSolBalances(byChain.SOL)
  const eth = await fetchEthBalances(byChain.ETH)
  const btc = await fetchBtcBalances(byChain.BTC)

  const totals = {
    ok: true as const,
    succeeded: sol.succeeded + eth.succeeded + btc.succeeded,
    failed: sol.failed + eth.failed + btc.failed,
    skipped: (sol.skipped ?? 0) + (eth.skipped ?? 0) + (btc.skipped ?? 0),
    mode: 'dispatched' as const,
  }
  const elapsedMs = Date.now() - startedAt
  console.info(`[fetch-balances] done succeeded=${totals.succeeded} failed=${totals.failed} skipped=${totals.skipped} elapsedMs=${elapsedMs}`)
  return totals
}
