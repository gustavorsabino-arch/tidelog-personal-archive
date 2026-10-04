import { sql, type SQL } from 'drizzle-orm'
import { transaction } from '@/lib/db/schema'

// Shared by the page/status filter and the posting guard. Only an unambiguous
// reciprocal leg within the SAME QB entity can inherit the JE of its peer.
// A direct link takes precedence. No write to historical accounting records.
export function effectiveInternalPostId(): SQL<string | null> {
  return sql<string | null>`coalesce(
    (select s.post_id from app.tx_qb_state s join app.qb_post p on p.id = s.post_id
      where s.tx_hash = ${transaction.txHash}
        and s.wallet_address = ${transaction.walletAddress}
        and s.direction = ${transaction.direction}
        and s.asset = ${transaction.asset}
        and p.posting_status in ('unposted', 'posted', 'posted_modified', 'posted_manually')),
    (select min(s2.post_id::text)::uuid
       from app.transaction t2
       join app.tx_qb_state s2 on s2.tx_hash = t2.tx_hash
         and s2.wallet_address = t2.wallet_address
         and s2.direction = t2.direction and s2.asset = t2.asset
       join app.qb_post p2 on p2.id = s2.post_id
      where t2.tx_hash = ${transaction.txHash}
        and t2.entity_id = ${transaction.entityId}
        and t2.asset = ${transaction.asset}
        and t2.direction <> ${transaction.direction}
        and lower(t2.wallet_address) = lower(${transaction.counterparty})
        and lower(t2.counterparty) = lower(${transaction.walletAddress})
        and abs(abs(t2.qty) - abs(${transaction.qty})) < 0.000000001
        and p2.posting_status in ('unposted', 'posted', 'posted_modified', 'posted_manually')
      having count(*) = 1)
    ,(select s.post_id from app.tx_qb_state s
      where s.tx_hash = ${transaction.txHash}
        and s.wallet_address = ${transaction.walletAddress}
        and s.direction = ${transaction.direction}
        and s.asset = ${transaction.asset})
  )`
}
