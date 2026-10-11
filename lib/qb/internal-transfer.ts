import { sql, type SQL } from 'drizzle-orm'
import { transaction } from '@/lib/db/schema'

// Posting status follows only the opposite wallet leg of the same transfer.
// A single on-chain hash can contain independent deposits to several wallets.
export function effectiveInternalPostId(): SQL<string | null> {
  const peer = sql`from app.transaction t2
    join app.tx_qb_state s2 on s2.tx_hash = t2.tx_hash
      and s2.wallet_address = t2.wallet_address
      and s2.direction = t2.direction and s2.asset = t2.asset
    join app.qb_post p2 on p2.id = s2.post_id
    where t2.tx_hash = ${transaction.txHash}
      and t2.entity_id = ${transaction.entityId}
      and t2.asset = ${transaction.asset}
      and t2.direction <> ${transaction.direction}
      and (t2.wallet_address = ${transaction.counterparty}
        or (left(t2.wallet_address, 2) = '0x' and left(${transaction.counterparty}, 2) = '0x'
          and lower(t2.wallet_address) = lower(${transaction.counterparty})))
      and (t2.counterparty = ${transaction.walletAddress}
        or (left(t2.counterparty, 2) = '0x' and left(${transaction.walletAddress}, 2) = '0x'
          and lower(t2.counterparty) = lower(${transaction.walletAddress})))
      and abs(abs(t2.qty) - abs(${transaction.qty}))
        <= greatest(0.000001, 0.000000001 * greatest(abs(t2.qty), abs(${transaction.qty})))`
  return sql<string | null>`coalesce(
    (select s.post_id from app.tx_qb_state s join app.qb_post p on p.id = s.post_id
      where s.tx_hash = ${transaction.txHash}
        and s.wallet_address = ${transaction.walletAddress}
        and s.direction = ${transaction.direction}
        and s.asset = ${transaction.asset}
        and p.posting_status in ('unposted', 'posted', 'posted_modified', 'posted_manually')),
    (select s2.post_id ${peer}
      and p2.posting_status in ('unposted', 'posted', 'posted_modified', 'posted_manually')
      order by p2.created_at desc, s2.post_id desc limit 1),
    (select s.post_id from app.tx_qb_state s
      where s.tx_hash = ${transaction.txHash}
        and s.wallet_address = ${transaction.walletAddress}
        and s.direction = ${transaction.direction}
        and s.asset = ${transaction.asset}),
    (select s2.post_id ${peer}
      order by p2.created_at desc, s2.post_id desc limit 1)
  )`
}
