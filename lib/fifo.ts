/**
 * FIFO (First In, First Out) cost basis engine.
 * Mirrors the v1 entity-wide FIFO behavior; preserves cost basis across
 * same-entity internal transfers.
 *
 * Two public functions:
 *   - computeFIFO: legacy shape, returns { gainLoss, unrealized }.
 *   - computeFIFOWithTrace: also returns per-row trace + open lots projection.
 *
 * computeFIFO is a thin wrapper over computeFIFOWithTrace.
 */
import type {
  Transaction,
  GainLossEntry,
  UnrealizedEntry,
  LotTraceEntry,
  OpenLotView,
} from './types'
import { STABLE_TOKENS } from './constants'

type Lot = {
  origQty: number
  remaining: number
  costPerUnit: number
  acqDate: string
  acqBlockTime: number
  acqTxHash: string
  acqWalletAddr: string
}

type InputTransaction = Transaction & { _synthetic?: boolean }

export interface FIFOTraceEntry {
  lots: LotTraceEntry[]
  balanceAfter: number
  internal: boolean
  internalPairedWalletAddr: string | null
  noBasis: boolean
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function computeFIFO(
  transactions: Transaction[],
  currentPrices: Record<string, number>,
  currentBalances?: Record<string, Record<string, number>>,
): { gainLoss: GainLossEntry[]; unrealized: UnrealizedEntry[] } {
  const { gainLoss, unrealized } = computeFIFOWithTrace(transactions, currentPrices, currentBalances)
  return { gainLoss, unrealized }
}

export function computeFIFOWithTrace(
  transactions: Transaction[],
  currentPrices: Record<string, number>,
  currentBalances?: Record<string, Record<string, number>>,
): {
  gainLoss: GainLossEntry[]
  unrealized: UnrealizedEntry[]
  trace: Map<string, FIFOTraceEntry>
  openLots: OpenLotView[]
} {
  const gainLoss: GainLossEntry[] = []
  const unrealized: UnrealizedEntry[] = []
  const trace = new Map<string, FIFOTraceEntry>()
  const openLots: OpenLotView[] = []

  const traceKey = (tx: InputTransaction) => `${tx.txHash}::${tx.walletAddr}::${tx.dir}`

  const entityAssetGroups = new Map<string, InputTransaction[]>()
  for (const tx of transactions as InputTransaction[]) {
    if (STABLE_TOKENS.has(tx.asset)) continue
    const key = `${tx.entity}::${tx.asset}`
    if (!entityAssetGroups.has(key)) entityAssetGroups.set(key, [])
    entityAssetGroups.get(key)!.push(tx)
  }

  for (const [groupKey, txs] of entityAssetGroups) {
    const sepIdx = groupKey.indexOf('::')
    const entity = groupKey.slice(0, sepIdx)
    const asset = groupKey.slice(sepIdx + 2)
    const moves = [...txs].sort((a, b) => a.blockTime - b.blockTime)
    const entityWallets = new Set(moves.map(tx => tx.walletAddr))
    const walletLots = new Map<string, Lot[]>()
    const walletBalance = new Map<string, number>()
    const txsByHash = new Map<string, InputTransaction[]>()

    for (const tx of moves) {
      if (!tx.txHash || tx._synthetic) continue
      if (!txsByHash.has(tx.txHash)) txsByHash.set(tx.txHash, [])
      txsByHash.get(tx.txHash)!.push(tx)
    }

    const internalTxHashes = new Set<string>()
    const internalPair = new Map<string, string>() // walletAddr → paired wallet, keyed by `${txHash}::${walletAddr}`
    for (const [hash, hashMoves] of txsByHash) {
      const outs = hashMoves.filter(tx => tx.dir === 'Out' && entityWallets.has(tx.walletAddr))
      const ins = hashMoves.filter(tx => tx.dir === 'In' && entityWallets.has(tx.walletAddr))
      if (!outs.length || !ins.length) continue
      const outWallets = new Set(outs.map(tx => tx.walletAddr))
      const differentWallets = ins.some(tx => !outWallets.has(tx.walletAddr))
      if (differentWallets) {
        internalTxHashes.add(hash)
        // Record pairing: each In's paired sender, each Out's paired receiver
        for (const out of outs) for (const inn of ins) if (inn.walletAddr !== out.walletAddr) {
          if (!internalPair.has(`${hash}::${inn.walletAddr}`)) internalPair.set(`${hash}::${inn.walletAddr}`, out.walletAddr)
          if (!internalPair.has(`${hash}::${out.walletAddr}`)) internalPair.set(`${hash}::${out.walletAddr}`, inn.walletAddr)
        }
      }
    }

    function getQueue(walletAddr: string): Lot[] {
      if (!walletLots.has(walletAddr)) walletLots.set(walletAddr, [])
      return walletLots.get(walletAddr)!
    }

    function getLastKnownPrice(beforeBlockTime: number): number {
      let price = 0
      let lastSeen = -1
      for (const lots of walletLots.values()) {
        for (const lot of lots) {
          if (lot.acqBlockTime < beforeBlockTime && lot.acqBlockTime > lastSeen && lot.costPerUnit > 0) {
            price = lot.costPerUnit
            lastSeen = lot.acqBlockTime
          }
        }
      }
      return price
    }

    function getIncomingLotPrice(tx: InputTransaction): number {
      if (isPositiveNumber(tx.price)) return tx.price
      return getLastKnownPrice(tx.blockTime)
    }

    function pushLot(queue: Lot[], tx: InputTransaction, qty: number, costPerUnit: number) {
      queue.push({
        origQty: qty,
        remaining: qty,
        costPerUnit,
        acqDate: tx.date,
        acqBlockTime: tx.blockTime,
        acqTxHash: tx.txHash,
        acqWalletAddr: tx.walletAddr,
      })
    }

    function bal(addr: string): number {
      return walletBalance.get(addr) ?? 0
    }
    function addBal(addr: string, delta: number) {
      walletBalance.set(addr, (walletBalance.get(addr) ?? 0) + delta)
    }

    for (const tx of moves) {
      const queue = getQueue(tx.walletAddr)
      const isInternal = !!tx.txHash && internalTxHashes.has(tx.txHash)
      const pairedWallet = isInternal ? (internalPair.get(`${tx.txHash}::${tx.walletAddr}`) ?? null) : null
      const traceLots: LotTraceEntry[] = []
      let noBasis = false

      if (tx.dir === 'In') {
        if (tx._synthetic) {
          const cost = isPositiveNumber(tx.price) ? tx.price : 0
          pushLot(queue, tx, tx.qty, cost)
          traceLots.push({
            qty: tx.qty,
            costPerUnit: cost,
            acqDate: tx.date,
            acqTxHash: tx.txHash,
            acqWalletAddr: tx.walletAddr,
            daysHeld: 0,
            term: 'ST',
            gain: 0,
          })
        } else if (isInternal) {
          const senderTx = moves.find(other =>
            other.txHash === tx.txHash &&
            other.dir === 'Out' &&
            other.walletAddr !== tx.walletAddr &&
            other.entity === entity,
          )
          if (senderTx) {
            const senderQueue = getQueue(senderTx.walletAddr)
            let toMove = tx.qty
            while (toMove > 1e-8 && senderQueue.length > 0) {
              const lot = senderQueue[0]
              const moved = Math.min(lot.remaining, toMove)
              queue.push({
                origQty: moved,
                remaining: moved,
                costPerUnit: lot.costPerUnit,
                acqDate: lot.acqDate,
                acqBlockTime: lot.acqBlockTime,
                acqTxHash: lot.acqTxHash,
                acqWalletAddr: lot.acqWalletAddr,
              })
              traceLots.push({
                qty: moved,
                costPerUnit: lot.costPerUnit,
                acqDate: lot.acqDate,
                acqTxHash: lot.acqTxHash,
                acqWalletAddr: lot.acqWalletAddr,
                daysHeld: 0, // movement, not realization
                term: 'ST',
                gain: 0,
              })
              lot.remaining -= moved
              toMove -= moved
              if (lot.remaining < 1e-8) senderQueue.shift()
            }
            if (toMove > 1e-8) {
              const cost = getIncomingLotPrice(tx)
              pushLot(queue, tx, toMove, cost)
              traceLots.push({
                qty: toMove,
                costPerUnit: cost,
                acqDate: tx.date,
                acqTxHash: tx.txHash,
                acqWalletAddr: tx.walletAddr,
                daysHeld: 0,
                term: 'ST',
                gain: 0,
              })
            }
          } else {
            const cost = getIncomingLotPrice(tx)
            pushLot(queue, tx, tx.qty, cost)
            traceLots.push({
              qty: tx.qty,
              costPerUnit: cost,
              acqDate: tx.date,
              acqTxHash: tx.txHash,
              acqWalletAddr: tx.walletAddr,
              daysHeld: 0,
              term: 'ST',
              gain: 0,
            })
          }
        } else {
          const cost = getIncomingLotPrice(tx)
          pushLot(queue, tx, tx.qty, cost)
          traceLots.push({
            qty: tx.qty,
            costPerUnit: cost,
            acqDate: tx.date,
            acqTxHash: tx.txHash,
            acqWalletAddr: tx.walletAddr,
            daysHeld: 0,
            term: 'ST',
            gain: 0,
          })
        }
        addBal(tx.walletAddr, tx.qty)
      } else {
        // Out
        if (isInternal) {
          // Internal Out: lots already moved by the In side. No realization.
          addBal(tx.walletAddr, -tx.qty)
        } else {
          let toDispose = tx.qty
          while (toDispose > 1e-8 && queue.length > 0) {
            const lot = queue[0]
            const consumed = Math.min(lot.remaining, toDispose)
            const sellPrice = isPositiveNumber(tx.price) ? tx.price : 0
            const costBasis = consumed * lot.costPerUnit
            const proceeds = consumed * sellPrice
            const gain = proceeds > 0 ? proceeds - costBasis : 0
            const holdingDays = (new Date(tx.date).getTime() - new Date(lot.acqDate).getTime()) / 86400000
            const term: 'ST' | 'LT' = holdingDays > 365 ? 'LT' : 'ST'

            gainLoss.push({
              wallet: tx.wallet,
              walletAddr: tx.walletAddr,
              entity,
              asset,
              qty: consumed,
              buyPrice: lot.costPerUnit,
              sellPrice,
              buyDate: lot.acqDate,
              soldDate: tx.date,
              gain,
              term,
              txHash: tx.txHash,
            })

            traceLots.push({
              qty: consumed,
              costPerUnit: lot.costPerUnit,
              acqDate: lot.acqDate,
              acqTxHash: lot.acqTxHash,
              acqWalletAddr: lot.acqWalletAddr,
              daysHeld: Math.floor(holdingDays),
              term,
              gain,
            })

            lot.remaining -= consumed
            toDispose -= consumed
            if (lot.remaining < 1e-8) queue.shift()
          }
          // Threshold of 1e-2 ORCA tolerates sub-cent dust residue (treasury
          // closeout sweeps often overshoot the tracked balance by fractions
          // of a token). Anything material still trips the flag.
          noBasis = toDispose > 1e-2 || (tx.qty > 0 && traceLots.length === 0)
          addBal(tx.walletAddr, -tx.qty)
        }
      }

      const balanceAfter = bal(tx.walletAddr)
      trace.set(traceKey(tx), {
        lots: traceLots,
        balanceAfter,
        internal: isInternal,
        internalPairedWalletAddr: pairedWallet,
        noBasis,
      })
    }

    // Build openLots projection
    for (const [walletAddr, lots] of walletLots.entries()) {
      const walletLabel =
        moves.find(tx => tx.walletAddr === walletAddr)?.wallet || walletAddr
      for (const lot of lots) {
        if (lot.remaining > 1e-8) {
          openLots.push({
            entity,
            asset,
            wallet: walletLabel,
            walletAddr,
            qty: lot.remaining,
            costPerUnit: lot.costPerUnit,
            acqDate: lot.acqDate,
          })
        }
      }
    }

    // Unrealized (mirrors existing computeFIFO logic)
    const currentPrice = currentPrices[asset] || 0
    if (!isPositiveNumber(currentPrice)) continue

    for (const [walletAddr, lots] of walletLots.entries()) {
      const remaining = lots.filter(lot => lot.remaining > 1e-8)
      if (!remaining.length) continue

      const qty = remaining.reduce((sum, lot) => sum + lot.remaining, 0)
      const costBasis = remaining.reduce((sum, lot) => sum + lot.remaining * lot.costPerUnit, 0)
      if (qty < 1e-8) continue

      const walletLabel =
        moves.find(tx => tx.walletAddr === walletAddr)?.wallet || walletAddr

      const balanceQty = currentBalances?.[walletAddr]?.[asset]
      const effectiveQty = typeof balanceQty === 'number' && Number.isFinite(balanceQty)
        ? Math.min(qty, Math.max(balanceQty, 0))
        : qty
      if (effectiveQty < 1e-8) continue

      const avgCost = qty > 0 ? costBasis / qty : 0
      const effectiveCostBasis = effectiveQty * avgCost

      unrealized.push({
        wallet: walletLabel,
        walletAddr,
        entity,
        asset,
        qty: effectiveQty,
        costBasis: effectiveCostBasis,
        currentPrice,
        unrealGain: effectiveQty * currentPrice - effectiveCostBasis,
      })
    }
  }

  return { gainLoss, unrealized, trace, openLots }
}
