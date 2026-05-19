import { computeFIFOWithTrace } from '@/lib/fifo'
import { db } from '@/lib/db'
import { transaction, transactionGain, fifoState } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { rowToTransaction } from '@/lib/treasury-transactions'
import { markSynthetic } from '@/lib/treasury-gain-loss'
import { toDbEntity } from '@/lib/entity'
import { computeGainsForEntity } from '@/lib/orca-gains-compute'
import type { Transaction } from '@/lib/types'

const FIFO_VERSION = 1

// FIFO-eligible assets only. The engine skips stables (lib/fifo.ts:73), so
// running it for USDC/USDT/PYUSD would produce zero rows. Match the G/L page's
// existing behavior of returning realized gains for SOL/ORCA only.
export const GAINS_ASSETS = ['SOL', 'ORCA'] as const
export type GainAsset = typeof GAINS_ASSETS[number]

/** Recompute and persist FIFO gains for a single (entity, asset). */
export async function recomputeEntityAssetGains(
  entityDisplay: string,
  asset: GainAsset,
): Promise<{ updated: number }> {
  const dbEntity = toDbEntity(entityDisplay)

  // Load ALL tx for entity+asset, ascending — FIFO is path-dependent so we
  // need genesis included. (Genesis rows only exist for ORCA today.)
  const txRows = await db
    .select()
    .from(transaction)
    .where(and(eq(transaction.entityId, dbEntity), eq(transaction.asset, asset)))
    .orderBy(asc(transaction.blockTime), asc(transaction.direction))

  // Map DB rows → Transaction shape (same path orca-ledger.ts uses), then mark
  // genesis as synthetic so FIFO treats it as a cost-basis lot rather than a
  // normal acquisition. markSynthetic is the single source of truth for this
  // marking — also used by G/L and ORCA Ledger paths.
  const txs: Transaction[] = txRows.map(r => rowToTransaction(r, ''))
  const marked = markSynthetic(txs)

  const { rows, openLots } = computeGainsForEntity(marked, asset)

  await db.transaction(async (tx) => {
    // Replace-all for this entity+asset — simplest correct semantics. Avoids
    // dangling rows when an upstream tx is deleted/corrected.
    await tx.delete(transactionGain).where(
      and(eq(transactionGain.entityId, dbEntity), eq(transactionGain.asset, asset)),
    )
    if (rows.length > 0) {
      // numeric columns in pg are typed as string by drizzle — stringify the
      // three numeric fields on the way in. Everything else passes through.
      const dbRows = rows.map(r => ({
        ...r,
        stGain: r.stGain.toString(),
        ltGain: r.ltGain.toString(),
        balanceAfter: r.balanceAfter.toString(),
      }))
      // Chunk to avoid postgres-js parameter limits (~65k params per stmt).
      const CHUNK = 500
      for (let i = 0; i < dbRows.length; i += CHUNK) {
        await tx.insert(transactionGain).values(dbRows.slice(i, i + CHUNK))
      }
    }
    const latestBlocktime = txRows.length > 0 ? txRows[txRows.length - 1].blockTime : null
    await tx
      .insert(fifoState)
      .values({
        entityId: dbEntity,
        asset,
        openLots,
        lastProcessedBlocktime: latestBlocktime,
        txCountAtLastCompute: txRows.length,
        fifoVersion: FIFO_VERSION,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [fifoState.entityId, fifoState.asset],
        set: {
          openLots,
          lastProcessedBlocktime: latestBlocktime,
          txCountAtLastCompute: txRows.length,
          fifoVersion: FIFO_VERSION,
          computedAt: new Date(),
        },
      })
  })

  return { updated: rows.length }
}

/** Entity-wide recompute: loops all FIFO-eligible assets in sequence. */
export async function recomputeEntityGains(
  entityDisplay: string,
): Promise<{ totals: Record<string, number> }> {
  const totals: Record<string, number> = {}
  for (const asset of GAINS_ASSETS) {
    const { updated } = await recomputeEntityAssetGains(entityDisplay, asset)
    totals[asset] = updated
  }
  return { totals }
}
