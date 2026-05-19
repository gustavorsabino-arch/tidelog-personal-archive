import { and, asc, eq, gte, lte, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transaction, wallet, transactionGain } from '@/lib/db/schema'
import { GAINS_ASSETS } from '@/lib/orca-gains-writer'
import { toDisplayEntity, toDbEntity } from '@/lib/entity'
import type { GainLossEntry, GainLossResponse, LotTraceEntry, Transaction } from '@/lib/types'

/**
 * Genesis (TGE) rows are seed cost-basis lots. The writer marks them synthetic
 * via this helper before passing to the FIFO engine. Still exported because
 * the writer in lib/orca-gains-writer.ts imports it — single source of truth.
 */
export function markSynthetic(txs: Transaction[]): Transaction[] {
  return txs.map((t) =>
    t.priceSource === 'genesis' ? ({ ...t, _synthetic: true } as Transaction) : t,
  )
}

export async function getTreasuryGainLoss(
  entity: string,
  opts?: { from?: number | null; to?: number | null },
): Promise<GainLossResponse> {
  const dbEntity = toDbEntity(entity)

  // Pull all disposal rows from transaction_gain joined to their underlying
  // transaction (for the disposal's price/blockTime) and wallet (for label).
  // Filter to the FIFO-eligible assets we materialize.
  const conditions = [
    eq(transactionGain.entityId, dbEntity),
    eq(transactionGain.direction, 'out'),
    inArray(transactionGain.asset, [...GAINS_ASSETS]),
  ]
  if (opts?.from != null) conditions.push(gte(transaction.blockTime, new Date(opts.from * 1000)))
  if (opts?.to != null) conditions.push(lte(transaction.blockTime, new Date(opts.to * 1000)))

  const rows = await db
    .select({
      tg: transactionGain,
      tx: transaction,
      walletLabel: wallet.label,
    })
    .from(transactionGain)
    .innerJoin(transaction, and(
      eq(transaction.txHash, transactionGain.txHash),
      eq(transaction.walletAddress, transactionGain.walletAddress),
      eq(transaction.direction, transactionGain.direction),
      // Asset must match — a single tx can carry moves for multiple assets.
      eq(transaction.asset, transactionGain.asset),
    ))
    .leftJoin(wallet, eq(wallet.address, transactionGain.walletAddress))
    .where(and(...conditions))
    .orderBy(asc(transaction.blockTime))

  // Expand each disposal row's `lots` JSONB into one GainLossEntry per consumed lot.
  // Per-lot acquisition price/date come from the lot trace; sell price/date come
  // from the disposal tx.
  const gainLoss: GainLossEntry[] = []
  for (const r of rows) {
    const lots = (r.tg.lots as LotTraceEntry[]) ?? []
    if (lots.length === 0) continue
    const sellPrice = r.tx.price != null ? Number(r.tx.price) : 0
    const soldDate = r.tx.blockTime.toISOString()
    for (const l of lots) {
      gainLoss.push({
        wallet: r.walletLabel ?? r.tx.walletAddress,
        walletAddr: r.tx.walletAddress,
        entity: toDisplayEntity(r.tg.entityId),
        asset: r.tg.asset,
        qty: l.qty,
        buyPrice: l.costPerUnit,
        sellPrice,
        buyDate: l.acqDate,
        soldDate,
        gain: l.gain,
        term: l.term,
        txHash: r.tg.txHash,
      })
    }
  }

  // Summary — same shape as the live-compute path returned.
  let shortTermGain = 0
  let longTermGain = 0
  for (const g of gainLoss) {
    if (g.term === 'ST') shortTermGain += g.gain
    else longTermGain += g.gain
  }

  return {
    gainLoss,
    summary: {
      totalGain: shortTermGain + longTermGain,
      shortTermGain,
      longTermGain,
      dispositions: gainLoss.length,
    },
  }
}

/**
 * Returns the distinct YYYY-MM months (UTC) in which this entity had
 * disposals, newest first. Sourced from the materialized transaction_gain
 * table — same data the main G/L route reads, no live FIFO.
 */
export async function getGainLossMonths(entity: string): Promise<string[]> {
  const dbEntity = toDbEntity(entity)

  const rows = await db
    .select({ blockTime: transaction.blockTime })
    .from(transactionGain)
    .innerJoin(transaction, and(
      eq(transaction.txHash, transactionGain.txHash),
      eq(transaction.walletAddress, transactionGain.walletAddress),
      eq(transaction.direction, transactionGain.direction),
      // Asset must match — a single tx can carry moves for multiple assets.
      eq(transaction.asset, transactionGain.asset),
    ))
    .where(and(
      eq(transactionGain.entityId, dbEntity),
      eq(transactionGain.direction, 'out'),
      inArray(transactionGain.asset, [...GAINS_ASSETS]),
    ))

  const set = new Set<string>()
  for (const r of rows) {
    const d = r.blockTime
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    set.add(`${y}-${m}`)
  }
  return Array.from(set).sort().reverse()
}
