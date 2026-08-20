import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * Smart prefill from posting history: for a given (wallet, counterparty)
 * pair, what counterparty GL / vendor / class did the most recent POSTED
 * transaction use? Keyed strictly per wallet — the same counterparty seen
 * from a different wallet never inherits (finance's rule).
 *
 * Used as the LOWEST-priority fallback in two places that must stay in
 * sync: the transactions list (what the operator sees prefilled) and
 * post-batch (what actually gets sent to QuickBooks).
 */

export type PostingHistoryEntry = {
  counterpartyGl: string | null
  vendor: string | null
  className: string | null
}

export function historyKey(walletAddress: string, counterparty: string, direction: 'in' | 'out'): string {
  return `${walletAddress}::${counterparty}::${direction}`
}

export async function loadPostingHistory(
  pairs: { walletAddress: string; counterparty: string; direction: 'in' | 'out' }[],
): Promise<Map<string, PostingHistoryEntry>> {
  const map = new Map<string, PostingHistoryEntry>()
  const unique = [...new Map(pairs.map((p) => [historyKey(p.walletAddress, p.counterparty, p.direction), p])).values()]
  if (unique.length === 0) return map

  const tuples = sql.join(unique.map((p) => sql`(${p.walletAddress}, ${p.counterparty}, ${p.direction})`), sql`, `)
  // posted_gl_account IS NOT NULL = the row was faithfully posted; its
  // vendor/class snapshots and per-tx counterparty-GL override are the
  // values finance actually approved last time. Direction is part of the
  // key: intercompany transfers post to mirrored accounts depending on
  // in/out (Due From vs Due To), so an OUT precedent must never prefill
  // an IN transaction.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (t.wallet_address, t.counterparty, t.direction)
      t.wallet_address AS wallet_address,
      t.counterparty   AS counterparty,
      t.direction      AS direction,
      s.counterparty_gl_override AS cp_gl,
      s.posted_vendor  AS vendor,
      s.posted_class   AS class_name
    FROM "app"."tx_qb_state" s
    JOIN "app"."transaction" t
      ON t.tx_hash = s.tx_hash
     AND t.wallet_address = s.wallet_address
     AND t.direction = s.direction
     AND t.asset = s.asset
    WHERE s.posted_gl_account IS NOT NULL
      AND (t.wallet_address, t.counterparty, t.direction) IN (${tuples})
    ORDER BY t.wallet_address, t.counterparty, t.direction, t.block_time DESC
  `) as unknown as {
    wallet_address: string
    counterparty: string
    direction: 'in' | 'out'
    cp_gl: string | null
    vendor: string | null
    class_name: string | null
  }[]

  for (const r of rows) {
    map.set(historyKey(r.wallet_address, r.counterparty, r.direction), {
      counterpartyGl: r.cp_gl,
      vendor: r.vendor,
      className: r.class_name,
    })
  }
  return map
}
