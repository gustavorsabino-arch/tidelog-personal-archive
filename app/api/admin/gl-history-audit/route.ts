import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth/require-permission'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/admin/gl-history-audit — READ-ONLY diagnostic.
 *
 * Finds every (wallet, counterparty) pair where the counterparty GL that
 * was actually POSTED last (per-wallet history — the value the smart
 * prefill now shows) DIFFERS from the memorized counterparty map (the old
 * cross-wallet default that used to win). These are exactly the pairs of
 * the "60330 vs 60410" class: places where the prefill changed after the
 * precedence fix, worth a human glance before the next posting run.
 *
 * Changes nothing. Auth: admin:manage_data.
 */
export async function GET(req: Request) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const rows = await db.execute(sql`
    WITH last_posted AS (
      SELECT DISTINCT ON (t.wallet_address, t.counterparty)
        t.entity_id,
        t.wallet_address,
        t.counterparty,
        s.counterparty_gl_override AS history_gl,
        t.block_time AS last_posted_at
      FROM "app"."tx_qb_state" s
      JOIN "app"."transaction" t
        ON t.tx_hash = s.tx_hash
       AND t.wallet_address = s.wallet_address
       AND t.direction = s.direction
       AND t.asset = s.asset
      WHERE s.posted_gl_account IS NOT NULL
        AND t.counterparty IS NOT NULL
      ORDER BY t.wallet_address, t.counterparty, t.block_time DESC
    )
    SELECT
      lp.entity_id,
      w.label AS wallet_label,
      lp.wallet_address,
      COALESCE(cw.label, lp.counterparty) AS counterparty_label,
      lp.counterparty,
      lp.history_gl,
      m.gl_account_number AS map_gl,
      to_char(lp.last_posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last_posted_on,
      (
        SELECT count(*)::int
        FROM "app"."transaction" t2
        LEFT JOIN "app"."tx_qb_state" s2
          ON s2.tx_hash = t2.tx_hash
         AND s2.wallet_address = t2.wallet_address
         AND s2.direction = t2.direction
         AND s2.asset = t2.asset
        WHERE t2.wallet_address = lp.wallet_address
          AND t2.counterparty = lp.counterparty
          AND t2.price_source IS DISTINCT FROM 'genesis'
          AND s2.posted_gl_account IS NULL
          AND s2.counterparty_gl_override IS NULL
      ) AS unposted_txs_affected
    FROM last_posted lp
    LEFT JOIN "app"."counterparty_gl_map" m
      ON m.entity_id = lp.entity_id AND m.counterparty_address = lp.counterparty
    LEFT JOIN "app"."wallet" w ON w.address = lp.wallet_address
    LEFT JOIN "app"."wallet" cw ON cw.address = lp.counterparty
    WHERE lp.history_gl IS NOT NULL
      AND m.gl_account_number IS NOT NULL
      AND lp.history_gl <> m.gl_account_number
    ORDER BY lp.entity_id, w.label, counterparty_label
  `) as unknown as {
    entity_id: string
    wallet_label: string | null
    wallet_address: string
    counterparty_label: string
    counterparty: string
    history_gl: string
    map_gl: string
    last_posted_on: string
    unposted_txs_affected: number
  }[]

  return NextResponse.json({
    ok: true,
    note: rows.length === 0
      ? 'No divergences: every counterparty map agrees with what each wallet actually posted last. Nothing to review.'
      : `${rows.length} (wallet, counterparty) pair(s) where the OLD memorized map differs from what was actually posted last. The prefill now shows lastPostedGl (per-wallet history); the map value is what it showed before the fix. Review any pair with unpostedTxsAffected > 0 before the next posting run.`,
    divergences: rows.map((r) => ({
      entity: r.entity_id,
      wallet: r.wallet_label ?? r.wallet_address,
      counterparty: r.counterparty_label,
      lastPostedGl: r.history_gl,
      oldMapGl: r.map_gl,
      lastPostedOn: r.last_posted_on,
      unpostedTxsAffected: r.unposted_txs_affected,
    })),
  })
}
