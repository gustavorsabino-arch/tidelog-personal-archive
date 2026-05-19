import { and, asc, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import { transaction, wallet, transactionGain, fifoState } from '@/lib/db/schema'
import { toDbEntity, toDisplayEntity } from '@/lib/entity'
import type {
  OrcaLedgerResponse, OrcaLedgerRow, OrcaWalletSummary, LotTraceEntry, OpenLotView,
} from '@/lib/types'

export async function getOrcaLedger(entity: string): Promise<OrcaLedgerResponse> {
  const dbEntity = toDbEntity(entity)
  const cpWallet = alias(wallet, 'cp_wallet_orca')

  // 1. Joined query: tx + own-wallet label + counterparty-wallet label/entity + gain row.
  //    Ascending by blockTime, In before Out at the same instant — matches the FIFO
  //    ordering the writer used to produce these gain rows. Genesis is included
  //    (no priceSource filter) — same as the live-compute path used to do.
  const joined = await db
    .select({
      txn: transaction,
      walletLabel: wallet.label,
      counterpartyLabel: cpWallet.label,
      counterpartyEntityId: cpWallet.entityId,
      gain: {
        stGain: transactionGain.stGain,
        ltGain: transactionGain.ltGain,
        realizedTerm: transactionGain.realizedTerm,
        internal: transactionGain.internal,
        internalPairedWalletAddr: transactionGain.internalPairedWalletAddr,
        noBasis: transactionGain.noBasis,
        lots: transactionGain.lots,
        balanceAfter: transactionGain.balanceAfter,
      },
    })
    .from(transaction)
    .leftJoin(wallet, eq(wallet.address, transaction.walletAddress))
    .leftJoin(cpWallet, eq(cpWallet.address, transaction.counterparty))
    .leftJoin(
      transactionGain,
      and(
        eq(transactionGain.txHash, transaction.txHash),
        eq(transactionGain.walletAddress, transaction.walletAddress),
        eq(transactionGain.direction, transaction.direction),
        // Asset is part of the PK on transaction_gain — a single tx can produce
        // moves for multiple assets on the same wallet+direction (e.g. swaps).
        eq(transactionGain.asset, transaction.asset),
      ),
    )
    .where(and(eq(transaction.entityId, dbEntity), eq(transaction.asset, 'ORCA')))
    .orderBy(asc(transaction.blockTime), asc(transaction.direction))

  // 2. Load the per-entity open-lot snapshot.
  const stateRows = await db
    .select()
    .from(fifoState)
    .where(and(eq(fifoState.entityId, dbEntity), eq(fifoState.asset, 'ORCA')))
  const openLots: OpenLotView[] = (stateRows[0]?.openLots as OpenLotView[]) ?? []

  // 3. Resolve internal-paired wallet labels. Some paired wallets may not appear in
  //    `joined` directly (e.g. no row's own walletAddress matches that addr), so do one
  //    targeted lookup.
  const pairedAddrs = Array.from(new Set(
    joined.map(r => r.gain?.internalPairedWalletAddr).filter((a): a is string => !!a),
  ))
  const pairedRows = pairedAddrs.length
    ? await db.select().from(wallet).where(inArray(wallet.address, pairedAddrs))
    : []
  const pairedLabelOf = new Map(pairedRows.map(w => [w.address, w.label]))

  // 4. Build OrcaLedgerRow[].
  const rows: OrcaLedgerRow[] = joined.map(r => {
    const lots = (r.gain?.lots as LotTraceEntry[]) ?? []
    const realizedGain = lots.reduce((s, l) => s + l.gain, 0)
    return {
      txHash: r.txn.txHash,
      walletAddr: r.txn.walletAddress,
      wallet: r.walletLabel ?? r.txn.walletAddress,
      entity: toDisplayEntity(r.txn.entityId),
      blockTime: Math.floor(r.txn.blockTime.getTime() / 1000),
      date: r.txn.blockTime.toISOString(),
      asset: 'ORCA',
      qty: Math.abs(Number(r.txn.qty)),
      dir: r.txn.direction === 'in' ? 'In' : 'Out',
      price: r.txn.price === null ? null : Number(r.txn.price),
      usd: r.txn.usd === null ? null : Number(r.txn.usd),
      priceSource: r.txn.priceSource,
      counterparty: r.txn.counterparty,
      counterpartyLabel: r.counterpartyLabel ?? null,
      counterpartyEntity: r.counterpartyEntityId ? toDisplayEntity(r.counterpartyEntityId) : null,
      internal: r.gain?.internal ?? false,
      internalPairedWalletAddr: r.gain?.internalPairedWalletAddr ?? null,
      internalPairedWalletLabel: r.gain?.internalPairedWalletAddr
        ? pairedLabelOf.get(r.gain.internalPairedWalletAddr) ?? null
        : null,
      balanceAfter: r.gain?.balanceAfter ? Number(r.gain.balanceAfter) : 0,
      lots,
      realizedGain,
      realizedTerm: r.gain?.realizedTerm ?? null,
      noBasis: r.gain?.noBasis ?? false,
    }
  })

  // 5. Build summaryByWallet from transaction_gain aggregates + open-lots grouped by wallet.
  // Sum the per-lot gains directly (full float64 precision) rather than the materialized
  // stGain+ltGain columns (numeric(20,2) — rounded to cents). The live-compute baseline
  // used full precision, so this preserves cent-perfect lifetime totals per wallet.
  const lifetimeByWallet = new Map<string, number>()
  for (const r of joined) {
    const lots = (r.gain?.lots as LotTraceEntry[]) ?? []
    if (lots.length === 0) continue
    const gain = lots.reduce((s, l) => s + l.gain, 0)
    if (gain === 0) continue
    lifetimeByWallet.set(r.txn.walletAddress, (lifetimeByWallet.get(r.txn.walletAddress) ?? 0) + gain)
  }
  const lotsByWallet = new Map<string, { qty: number; costPerUnit: number; acqDate: string }[]>()
  for (const lot of openLots) {
    if (!lotsByWallet.has(lot.walletAddr)) lotsByWallet.set(lot.walletAddr, [])
    lotsByWallet.get(lot.walletAddr)!.push({ qty: lot.qty, costPerUnit: lot.costPerUnit, acqDate: lot.acqDate })
  }
  const labelByWallet = new Map<string, string>()
  for (const r of joined) {
    if (r.walletLabel) labelByWallet.set(r.txn.walletAddress, r.walletLabel)
  }
  const summaryByWallet: Record<string, OrcaWalletSummary> = {}
  const allWallets = new Set<string>([
    ...labelByWallet.keys(),
    ...lifetimeByWallet.keys(),
    ...lotsByWallet.keys(),
  ])
  for (const addr of allWallets) {
    const remainingLots = lotsByWallet.get(addr) ?? []
    const totalQty = remainingLots.reduce((s, l) => s + l.qty, 0)
    const totalCost = remainingLots.reduce((s, l) => s + l.qty * l.costPerUnit, 0)
    const lifetime = lifetimeByWallet.get(addr) ?? 0
    if (totalQty < 1e-8 && Math.abs(lifetime) < 1e-8) continue
    summaryByWallet[addr] = {
      walletAddr: addr,
      wallet: labelByWallet.get(addr) ?? addr,
      totalQty,
      avgCostPerUnit: totalQty > 0 ? totalCost / totalQty : 0,
      remainingLots,
      lifetimeRealizedGain: lifetime,
      noBasis: totalQty > 1e-8 && remainingLots.length === 0,
    }
  }

  return {
    rows,
    summaryByWallet,
    // Reflect when the materialized data was last refreshed — closer to truth
    // than a fresh now(). Falls back to now() if no fifo_state row exists yet.
    computedAt: stateRows[0]?.computedAt?.toISOString() ?? new Date().toISOString(),
  }
}
