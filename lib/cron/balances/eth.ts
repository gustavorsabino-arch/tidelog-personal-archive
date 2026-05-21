import type { WalletRow, FetchBalancesResult } from './sol'

export async function fetchEthBalances(wallets: WalletRow[]): Promise<FetchBalancesResult> {
  if (wallets.length === 0) return { succeeded: 0, failed: 0, skipped: 0 }
  console.warn(`[fetch-balances][ETH] stub: not yet implemented, skipping ${wallets.length} wallets`)
  return { succeeded: 0, failed: 0, skipped: wallets.length }
}
