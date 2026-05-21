import type { Transaction } from './types'
import { fmtUSD, fmtNum } from './format'

/**
 * Computed default for the Description column when the user hasn't customized
 * one. Mirrors v1's auto-fill style:
 *
 *   "In ORCA 10.50 @ $2.00 = $21.00 (AbCdEf01…)"
 *   "Out SOL 1.2340 (no price)"
 *
 * The truncated txHash gives the user disambiguating context without cluttering
 * the QB description field with an 88-char base58 signature.
 *
 * Pure — no DB, no I/O. Called from rowToTransaction (server-side) AND can be
 * safely re-called on the client if needed.
 */
export function defaultDescription(t: Transaction): string {
  const shortHash = t.txHash.slice(0, 8) + '…'
  // SOL/decimals tokens deserve 4 decimal places; everything else 2.
  const qty = fmtNum(t.qty, t.asset === 'SOL' ? 4 : 2)
  if (t.price == null || t.usd == null) {
    return `${t.dir} ${t.asset} ${qty} (no price)`
  }
  const price = `$${t.price.toFixed(2)}`
  const usd = fmtUSD(t.usd)
  return `${t.dir} ${t.asset} ${qty} @ ${price} = ${usd} (${shortHash})`
}
