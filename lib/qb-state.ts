import { fmtUSD, fmtNum } from './format'

/**
 * Computed default for the Description column when the user hasn't customized
 * one. Format matches v1 with the asset shown once (not duplicated):
 *
 *   "In - USDC - 38.61 - $38.61 - 62BVzBMmaUFLmwVshvK2EVwUrUVYNxLWKjEcJPnrkpF34Wy7TMuTukVDSeEx5aUu5KehD1YTnYSLfuyqtvAYzktu"
 *   "Out - SOL - 1.2340 - (no price) - 5cwQxcDjZdFyZ3u8W3dVYmKL..."
 *
 * Full tx hash (not truncated) so descriptions cross-reference cleanly with
 * v1-posted journal entries and on-chain audit tooling.
 *
 * Pure — no DB, no I/O. Called from rowToTransaction (server-side) AND can be
 * safely re-called on the client if needed.
 */
export function defaultDescription(t: {
  dir: string
  asset: string
  qty: number
  usd: number | null
  txHash: string
}): string {
  // SOL/decimals tokens deserve 4 decimal places; everything else 2.
  const qty = fmtNum(t.qty, t.asset === 'SOL' ? 4 : 2)
  const amount = t.usd != null ? fmtUSD(t.usd) : '(no price)'
  return `${t.dir} - ${t.asset} - ${qty} - ${amount} - ${t.txHash}`
}
