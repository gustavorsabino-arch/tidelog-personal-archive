/**
 * FIFO (First In, First Out) cost basis engine.
 * Mirrors the v1 entity-wide FIFO behavior closely enough to preserve
 * cost basis across same-entity internal transfers.
 */
import type { Transaction, GainLossEntry, UnrealizedEntry } from './types'
import { STABLE_TOKENS } from './constants'

type Lot = {
  origQty: number
  remaining: number
  costPerUnit: number
  acqDate: string
  acqBlockTime: number
  acqTxHash: string
}

type InputTransaction = Transaction & { _synthetic?: boolean }

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function computeFIFO(
  transactions: Transaction[],
  currentPrices: Record<string, number>,
  currentBalances?: Record<string, Record<string, number>>
): { gainLoss: GainLossEntry[]; unrealized: UnrealizedEntry[] } {
  const gainLoss: GainLossEntry[] = []
  const unrealized: UnrealizedEntry[] = []

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
    const txsByHash = new Map<string, InputTransaction[]>()

    for (const tx of moves) {
      if (!tx.txHash || tx._synthetic) continue
      if (!txsByHash.has(tx.txHash)) txsByHash.set(tx.txHash, [])
      txsByHash.get(tx.txHash)!.push(tx)
    }

    const internalTxHashes = new Set<string>()
    for (const [hash, hashMoves] of txsByHash) {
      const outs = hashMoves.filter(tx => tx.dir === 'Out' && entityWallets.has(tx.walletAddr))
      const ins = hashMoves.filter(tx => tx.dir === 'In' && entityWallets.has(tx.walletAddr))
      if (!outs.length || !ins.length) continue

      const outWallets = new Set(outs.map(tx => tx.walletAddr))
      const differentWallets = ins.some(tx => !outWallets.has(tx.walletAddr))
      if (differentWallets) internalTxHashes.add(hash)
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
      })
    }

    for (const tx of moves) {
      const queue = getQueue(tx.walletAddr)

      if (tx.dir === 'In') {
        if (tx._synthetic) {
          pushLot(queue, tx, tx.qty, isPositiveNumber(tx.price) ? tx.price : 0)
          continue
        }

        if (internalTxHashes.has(tx.txHash)) {
          const senderTx = moves.find(other =>
            other.txHash === tx.txHash &&
            other.dir === 'Out' &&
            other.walletAddr !== tx.walletAddr &&
            other.entity === entity
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
              })
              lot.remaining -= moved
              toMove -= moved
              if (lot.remaining < 1e-8) senderQueue.shift()
            }

            if (toMove > 1e-8) {
              pushLot(queue, tx, toMove, getIncomingLotPrice(tx))
            }
            continue
          }
        }

        pushLot(queue, tx, tx.qty, getIncomingLotPrice(tx))
        continue
      }

      if (internalTxHashes.has(tx.txHash)) {
        continue
      }

      let toDispose = tx.qty
      while (toDispose > 1e-8 && queue.length > 0) {
        const lot = queue[0]
        const consumed = Math.min(lot.remaining, toDispose)
        const sellPrice = isPositiveNumber(tx.price) ? tx.price : 0
        const costBasis = consumed * lot.costPerUnit
        const proceeds = consumed * sellPrice
        const gain = proceeds > 0 ? proceeds - costBasis : 0
        const holdingDays = (new Date(tx.date).getTime() - new Date(lot.acqDate).getTime()) / 86400000

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
          term: holdingDays > 365 ? 'LT' : 'ST',
          txHash: tx.txHash,
        })

        lot.remaining -= consumed
        toDispose -= consumed
        if (lot.remaining < 1e-8) queue.shift()
      }
    }

    const currentPrice = currentPrices[asset] || 0
    if (!isPositiveNumber(currentPrice)) continue

    for (const [walletAddr, lots] of walletLots.entries()) {
      const openLots = lots.filter(lot => lot.remaining > 1e-8)
      if (!openLots.length) continue

      const qty = openLots.reduce((sum, lot) => sum + lot.remaining, 0)
      const costBasis = openLots.reduce((sum, lot) => sum + lot.remaining * lot.costPerUnit, 0)
      if (qty < 1e-8) continue

      const walletLabel =
        moves.find(tx => tx.walletAddr === walletAddr)?.wallet ||
        walletAddr

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

  return { gainLoss, unrealized }
}
