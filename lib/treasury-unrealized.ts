/**
 * Unrealized cost-basis orchestrator.
 *
 * Mirrors the lib/orca-ledger.ts pattern: query transactions WITHOUT the
 * generic genesis filter, mark genesis rows as `_synthetic` so the FIFO
 * engine treats them as opening-balance lots (preserves cost basis seeded
 * by migration 0007). Generalized to all non-stable assets, and supports
 * point-in-time snapshots via `asOf` (UTC end-of-month).
 */

import { computeFIFOWithTrace } from '@/lib/fifo'
import { getCurrentPrices, getHistoricalPrice } from '@/lib/defillama'
import { getTreasuryTransactionsAsc } from '@/lib/treasury-transactions'
import { ENTITIES } from '@/lib/constants'
import type {
  OpenLotView,
  Transaction,
  UnrealizedLot,
  UnrealizedPosition,
  UnrealizedResponse,
} from '@/lib/types'

export const ALL_ENTITIES_SENTINEL = 'All'

export interface GetUnrealizedParams {
  entity: string
  /** 'YYYY-MM' for UTC-end-of-month snapshot; null/undefined for live */
  asOf?: string | null
}

type RolledPosition = {
  entity: string
  asset: string
  wallet: string
  walletAddr: string
  qty: number
  costBasis: number
  acqDateMin: string
  acqDateMax: string
  lotCount: number
}

const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/

function endOfMonthUtc(yyyyMm: string): Date {
  const [y, m] = yyyyMm.split('-').map(Number)
  // Day 0 of next month = last day of this month (UTC)
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
}

function priorMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function ymOfUnix(unix: number): string {
  const d = new Date(unix * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function ymOfNow(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function markSynthetic(txs: Transaction[]): Transaction[] {
  return txs.map((t) =>
    t.priceSource === 'genesis' ? ({ ...t, _synthetic: true } as Transaction) : t,
  )
}

function rollUpPositions(lots: OpenLotView[]): Map<string, RolledPosition> {
  const map = new Map<string, RolledPosition>()
  for (const lot of lots) {
    const key = `${lot.walletAddr}::${lot.asset}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        entity: lot.entity,
        asset: lot.asset,
        wallet: lot.wallet,
        walletAddr: lot.walletAddr,
        qty: lot.qty,
        costBasis: lot.qty * lot.costPerUnit,
        acqDateMin: lot.acqDate,
        acqDateMax: lot.acqDate,
        lotCount: 1,
      })
    } else {
      existing.qty += lot.qty
      existing.costBasis += lot.qty * lot.costPerUnit
      if (lot.acqDate < existing.acqDateMin) existing.acqDateMin = lot.acqDate
      if (lot.acqDate > existing.acqDateMax) existing.acqDateMax = lot.acqDate
      existing.lotCount += 1
    }
  }
  return map
}

async function fetchPricesForAssets(
  assets: string[],
  timestamp: number | null,
): Promise<{ prices: Record<string, number>; missing: string[] }> {
  if (!assets.length) return { prices: {}, missing: [] }
  const prices: Record<string, number> = {}
  const missing: string[] = []

  if (timestamp === null) {
    const live = await getCurrentPrices(assets).catch(() => ({} as Record<string, number>))
    for (const a of assets) {
      const p = live[a]
      if (typeof p === 'number' && p > 0) prices[a] = p
      else missing.push(a)
    }
    return { prices, missing }
  }

  // Historical prices — one call per asset. DeFiLlama caches at the route.
  const results = await Promise.all(assets.map((a) => getHistoricalPrice(a, timestamp)))
  results.forEach((p, i) => {
    const a = assets[i]
    if (typeof p === 'number' && p > 0) prices[a] = p
    else missing.push(a)
  })
  return { prices, missing }
}

export async function getTreasuryUnrealized({
  entity,
  asOf,
}: GetUnrealizedParams): Promise<UnrealizedResponse> {
  const computedAt = new Date().toISOString()

  const asOfYm = asOf && YYYY_MM.test(asOf) ? asOf : null
  const asOfDate = asOfYm ? endOfMonthUtc(asOfYm) : null
  const asOfUnix = asOfDate ? Math.floor(asOfDate.getTime() / 1000) : null
  const priorYm = asOfYm ? priorMonth(asOfYm) : null
  const priorDate = priorYm ? endOfMonthUtc(priorYm) : null
  const priorUnix = priorDate ? Math.floor(priorDate.getTime() / 1000) : null

  // 1. Pull all txs for entity (asc, includes genesis). 'All' fans out to every
  //    entity in parallel and concatenates — FIFO re-sorts within each
  //    entity::asset group, and internal-transfer detection stays scoped per
  //    entity, so concat-and-feed is correct.
  const entitiesToFetch = entity === ALL_ENTITIES_SENTINEL ? [...ENTITIES] : [entity]
  const allTxs = (
    await Promise.all(entitiesToFetch.map((e) => getTreasuryTransactionsAsc(e)))
  ).flat()

  // monthsAvailable derives from ALL non-genesis blockTimes (genesis is a
  // synthetic basis row, not user-meaningful as a snapshot point).
  const monthSet = new Set<string>()
  for (const t of allTxs) {
    if (t.priceSource === 'genesis') continue
    monthSet.add(ymOfUnix(t.blockTime))
  }
  const monthsAvailable = [...monthSet].sort().reverse()

  // 2. Snapshot at asOf (or all txs for live).
  const txsAtAsOf = asOfUnix !== null
    ? allTxs.filter((t) => t.blockTime <= asOfUnix)
    : allTxs

  // 3. Run engine — pass empty currentPrices to skip the engine's aggregated
  //    `unrealized` (we roll up from `openLots` ourselves so we can apply
  //    historical prices and compute lot-level detail).
  const { openLots: openLotsAtAsOf } = computeFIFOWithTrace(markSynthetic(txsAtAsOf), {})

  // 4. Same for priorAsOf when set — used only to compute priorValue per
  //    (walletAddr, asset). Skipped when not requested.
  const priorQtyByKey = new Map<string, number>()
  if (priorUnix !== null) {
    const txsAtPrior = allTxs.filter((t) => t.blockTime <= priorUnix)
    const { openLots: priorLots } = computeFIFOWithTrace(markSynthetic(txsAtPrior), {})
    for (const lot of priorLots) {
      const key = `${lot.walletAddr}::${lot.asset}`
      priorQtyByKey.set(key, (priorQtyByKey.get(key) ?? 0) + lot.qty)
    }
  }

  // 5. Roll up snapshot lots → group-level positions; gather assets to price.
  const positionMap = rollUpPositions(openLotsAtAsOf)
  const assetsHeld = [...new Set([...positionMap.values()].map((p) => p.asset))]

  // 6. Fetch prices.
  //    - Current value column always uses LIVE current prices (for table's
  //      "Current $" column). When asOf is set, we additionally fetch the
  //      EOM price for delta vs prior month.
  //    - Falling back to live current price when asOf is the current month
  //      and historical isn't yet available.
  const { prices: livePrices, missing: missingLive } = await fetchPricesForAssets(assetsHeld, null)

  let snapshotPrices = livePrices
  let snapshotMissing = missingLive
  if (asOfUnix !== null) {
    const isCurrentMonth = asOfYm === ymOfNow()
    const { prices: histPrices, missing: histMissing } = await fetchPricesForAssets(
      assetsHeld,
      asOfUnix,
    )
    if (isCurrentMonth) {
      // Patch in live prices where historical isn't published yet.
      snapshotPrices = { ...livePrices, ...histPrices }
      snapshotMissing = assetsHeld.filter((a) => !(a in snapshotPrices))
    } else {
      snapshotPrices = histPrices
      snapshotMissing = histMissing
    }
  }

  let priorPrices: Record<string, number> = {}
  if (priorUnix !== null) {
    const { prices } = await fetchPricesForAssets(assetsHeld, priorUnix)
    priorPrices = prices
  }

  // 7. Enrich each rolled-up position with current/prior pricing.
  const positions: UnrealizedPosition[] = []
  for (const [, p] of positionMap) {
    const px = snapshotPrices[p.asset]
    const hasPx = typeof px === 'number' && px > 0
    const currentPrice = hasPx ? px : null
    const currentValue = hasPx ? p.qty * px : null
    const unrealGain = hasPx ? p.qty * px - p.costBasis : null
    const returnPct = hasPx && p.costBasis > 0 ? (unrealGain! / p.costBasis) * 100 : null
    const avgCostPerUnit = p.qty > 0 ? p.costBasis / p.qty : 0

    let priorPrice: number | null = null
    let priorValue: number | null = null
    let deltaMonth: number | null = null
    if (priorUnix !== null) {
      const pp = priorPrices[p.asset]
      priorPrice = typeof pp === 'number' && pp > 0 ? pp : null
      const priorQty = priorQtyByKey.get(`${p.walletAddr}::${p.asset}`) ?? 0
      // Position didn't exist last month → priorValue = 0, delta = currentValue.
      // Position existed but no prior price → priorValue=null, delta=null.
      if (priorQty < 1e-8) {
        priorValue = 0
      } else if (priorPrice !== null) {
        priorValue = priorQty * priorPrice
      } else {
        priorValue = null
      }
      if (currentValue !== null && priorValue !== null) {
        deltaMonth = currentValue - priorValue
      }
    }

    positions.push({
      entity: p.entity,
      asset: p.asset,
      wallet: p.wallet,
      walletAddr: p.walletAddr,
      qty: p.qty,
      costBasis: p.costBasis,
      avgCostPerUnit,
      currentPrice,
      currentValue,
      unrealGain,
      returnPct,
      acqDateMin: p.acqDateMin,
      acqDateMax: p.acqDateMax,
      lotCount: p.lotCount,
      priorPrice,
      priorValue,
      deltaMonth,
    })
  }

  // 8. Same enrichment at the per-lot level for the expandable detail rows.
  const lots: UnrealizedLot[] = openLotsAtAsOf.map((lot) => {
    const px = snapshotPrices[lot.asset]
    const hasPx = typeof px === 'number' && px > 0
    const costBasis = lot.qty * lot.costPerUnit
    const currentPrice = hasPx ? px : null
    const currentValue = hasPx ? lot.qty * px : null
    const unrealGain = hasPx ? lot.qty * px - costBasis : null
    const returnPct = hasPx && costBasis > 0 ? (unrealGain! / costBasis) * 100 : null
    return {
      entity: lot.entity,
      asset: lot.asset,
      wallet: lot.wallet,
      walletAddr: lot.walletAddr,
      acqDate: lot.acqDate,
      qty: lot.qty,
      costPerUnit: lot.costPerUnit,
      costBasis,
      currentPrice,
      currentValue,
      unrealGain,
      returnPct,
    }
  })

  // 9. Filter dropdown options derive from the snapshot's positions only.
  const walletMap = new Map<string, string>()
  for (const p of positions) {
    if (!walletMap.has(p.walletAddr)) walletMap.set(p.walletAddr, p.wallet)
  }
  const walletOptions = [...walletMap.entries()]
    .map(([walletAddr, wallet]) => ({ walletAddr, wallet }))
    .sort((a, b) => a.wallet.localeCompare(b.wallet))
  const tokenOptions = [...new Set(positions.map((p) => p.asset))].sort()

  return {
    positions: positions.sort((a, b) => (b.unrealGain ?? 0) - (a.unrealGain ?? 0)),
    lots,
    asOf: asOfDate ? asOfDate.toISOString() : null,
    priorAsOf: priorDate ? priorDate.toISOString() : null,
    monthsAvailable,
    walletOptions,
    tokenOptions,
    missingPrices: snapshotMissing,
    computedAt,
  }
}
