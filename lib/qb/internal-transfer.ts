import { sql, type SQL } from 'drizzle-orm'
import { transaction } from '@/lib/db/schema'

// All wallet views of a hash within one QB entity share posting status.
// Prefer active links over historical voided or failed attempts.
export function effectiveInternalPostId(): SQL<string | null> {
  return sql<string | null>`coalesce(
    (select s.post_id from app.tx_qb_state s join app.qb_post p on p.id = s.post_id
      where s.tx_hash = ${transaction.txHash}
        and s.wallet_address = ${transaction.walletAddress}
        and s.direction = ${transaction.direction}
        and s.asset = ${transaction.asset}
        and p.posting_status in ('unposted', 'posted', 'posted_modified', 'posted_manually')),
    (select s2.post_id from app.tx_qb_state s2 join app.qb_post p2 on p2.id = s2.post_id
      where s2.tx_hash = ${transaction.txHash}
        and s2.entity_id = ${transaction.entityId}
        and p2.posting_status in ('unposted', 'posted', 'posted_modified', 'posted_manually')
      order by p2.created_at desc, s2.post_id desc limit 1),
    (select s.post_id from app.tx_qb_state s
      where s.tx_hash = ${transaction.txHash}
        and s.wallet_address = ${transaction.walletAddress}
        and s.direction = ${transaction.direction}
        and s.asset = ${transaction.asset}),
    (select s2.post_id from app.tx_qb_state s2 join app.qb_post p2 on p2.id = s2.post_id
      where s2.tx_hash = ${transaction.txHash} and s2.entity_id = ${transaction.entityId}
      order by p2.created_at desc, s2.post_id desc limit 1)
  )`
}
