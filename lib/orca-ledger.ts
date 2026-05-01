import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transaction, wallet } from '@/lib/db/schema'
import { computeFIFOWithTrace } from '@/lib/fifo'
import { getCurrentPrices } from '@/lib/defillama'
import { rowToTransaction } from '@/lib/treasury-transactions'
import { toDbEntity, toDisplayEntity } from '@/lib/entity'
import type {
  OrcaLedgerResponse,
  OrcaLedgerRow,
  OrcaWalletSummary,
  Transaction,
} from '@/lib/types'

type WalletRow = typeof wallet.$inferSelect

export async function getOrcaLedger(entity: string): Promise<OrcaLedgerResponse> {
  // 1. Pull all ORCA tx for the entity, ascending by blockTime, In before Out
  //    at the same timestamp. Genesis is included (no IS DISTINCT FROM clause).
  const dbEntity = toDbEntity(entity)
  const txRows = await db
    .select()
    .from(transaction)
    .where(and(eq(transaction.entityId, dbEntity), eq(transaction.asset, 'ORCA')))
    .orderBy(asc(transaction.blockTime), asc(transaction.direction))

  // 2. Resolve wallet labels for tx wallets and counterparties.
  const walletAddrs = Array.from(new Set(txRows.map(r => r.walletAddress)))
  const counterpartyAddrs = Array.from(new Set(
    txRows.map(r => r.counterparty).filter((a): a is string => !!a),
  ))
  const allLookupAddrs = Array.from(new Set([...walletAddrs, ...counterpartyAddrs]))
  const walletRows: WalletRow[] = allLookupAddrs.length
    ? await db.select().from(wallet).where(inArray(wallet.address, allLookupAddrs))
    : []
  const walletInfo = new Map(walletRows.map(w => [w.address, { label: w.label, entity: toDisplayEntity(w.entityId) }]))
  const labelOf = (addr: string) => walletInfo.get(addr)?.label ?? addr

  // 3. Map DB rows → Transaction shape, including the synthetic flag for genesis.
  const transactions: Transaction[] = txRows.map(r =>
    rowToTransaction(r, walletInfo.get(r.walletAddress)?.label ?? ''),
  )
  const syntheticByKey = new Set<string>()
  for (const r of txRows) {
    if (r.priceSource === 'genesis') {
      syntheticByKey.add(`${r.txHash}::${r.walletAddress}::${r.direction === 'in' ? 'In' : 'Out'}`)
    }
  }
  const fifoInput = transactions.map(t => {
    const key = `${t.txHash}::${t.walletAddr}::${t.dir}`
    return syntheticByKey.has(key) ? { ...t, _synthetic: true } : t
  }) as Transaction[]

  // 4. Current price for unrealized side.
  const currentPrices = await getCurrentPrices().catch(() => ({} as Record<string, number>))
  const orcaPrice = typeof currentPrices.ORCA === 'number' ? currentPrices.ORCA : 0

  // 5. Run engine.
  const { gainLoss, trace, openLots } = computeFIFOWithTrace(
    fifoInput,
    orcaPrice > 0 ? { ORCA: orcaPrice } : {},
  )

  // 6. Build OrcaLedgerRow[].
  const rows: OrcaLedgerRow[] = transactions.map((t) => {
    const key = `${t.txHash}::${t.walletAddr}::${t.dir}`
    const traceEntry = trace.get(key) ?? {
      lots: [],
      balanceAfter: 0,
      internal: false,
      internalPairedWalletAddr: null,
      noBasis: false,
    }
    const cp = t.counterparty ? walletInfo.get(t.counterparty) ?? null : null
    const realizedGain = traceEntry.lots.reduce((s, l) => s + l.gain, 0)
    const terms = new Set(traceEntry.lots.map(l => l.term))
    const realizedTerm: 'ST' | 'LT' | 'mixed' | null =
      t.dir !== 'Out' || traceEntry.lots.length === 0
        ? null
        : terms.size > 1
          ? 'mixed'
          : (terms.has('LT') ? 'LT' : 'ST')

    return {
      txHash: t.txHash,
      walletAddr: t.walletAddr,
      wallet: t.wallet,
      entity: t.entity,
      blockTime: t.blockTime,
      date: t.date,
      asset: 'ORCA',
      qty: t.qty,
      dir: t.dir,
      price: t.price,
      usd: t.usd,
      priceSource: t.priceSource,
      counterparty: t.counterparty,
      counterpartyLabel: cp?.label ?? null,
      counterpartyEntity: cp?.entity ?? null,
      internal: traceEntry.internal,
      internalPairedWalletAddr: traceEntry.internalPairedWalletAddr,
      internalPairedWalletLabel: traceEntry.internalPairedWalletAddr
        ? walletInfo.get(traceEntry.internalPairedWalletAddr)?.label ?? null
        : null,
      balanceAfter: traceEntry.balanceAfter,
      lots: traceEntry.lots,
      realizedGain,
      realizedTerm,
      noBasis: traceEntry.noBasis,
    }
  })

  // 7. Compute summaryByWallet.
  const summaryByWallet: Record<string, OrcaWalletSummary> = {}
  const lifetimeByWallet = new Map<string, number>()
  for (const g of gainLoss) {
    lifetimeByWallet.set(g.walletAddr, (lifetimeByWallet.get(g.walletAddr) ?? 0) + g.gain)
  }
  const lotsByWallet = new Map<string, { qty: number; costPerUnit: number; acqDate: string }[]>()
  for (const lot of openLots) {
    if (!lotsByWallet.has(lot.walletAddr)) lotsByWallet.set(lot.walletAddr, [])
    lotsByWallet.get(lot.walletAddr)!.push({ qty: lot.qty, costPerUnit: lot.costPerUnit, acqDate: lot.acqDate })
  }
  // Walk every wallet that ever appeared in this entity's ORCA history, plus
  // wallets with realized gains but no remaining open lots.
  const allWallets = new Set<string>([...walletAddrs, ...lifetimeByWallet.keys()])
  for (const addr of allWallets) {
    const remainingLots = lotsByWallet.get(addr) ?? []
    const totalQty = remainingLots.reduce((s, l) => s + l.qty, 0)
    const totalCost = remainingLots.reduce((s, l) => s + l.qty * l.costPerUnit, 0)
    const lifetime = lifetimeByWallet.get(addr) ?? 0
    if (totalQty < 1e-8 && Math.abs(lifetime) < 1e-8) continue
    summaryByWallet[addr] = {
      walletAddr: addr,
      wallet: labelOf(addr),
      totalQty,
      avgCostPerUnit: totalQty > 0 ? totalCost / totalQty : 0,
      remainingLots,
      lifetimeRealizedGain: lifetime,
      noBasis: totalQty > 1e-8 && remainingLots.length === 0,
    }
  }

  return { rows, summaryByWallet, computedAt: new Date().toISOString() }
}
