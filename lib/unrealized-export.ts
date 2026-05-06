import * as XLSX from 'xlsx'
import type { UnrealizedPosition, UnrealizedLot } from '@/lib/types'

interface ExportArgs {
  positions: UnrealizedPosition[]
  lots: UnrealizedLot[]
  computedAt: string
  entity: string
  asOf: string | null
  activeFilters: { token?: string; wallet?: string; month?: string; sign?: string }
}

// Public: build an .xlsx workbook in-browser and trigger download.
// Browser-only (XLSX.writeFile uses saveAs under the hood).
export function exportUnrealizedXLSX(args: ExportArgs): void {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildPositionsSheet(args), 'Positions')
  XLSX.utils.book_append_sheet(wb, buildLotsDetailSheet(args), 'Lots Detail')

  const filtered = Object.values(args.activeFilters).some(v => !!v) ? '_filtered' : ''
  const date = new Date().toISOString().slice(0, 10)
  const snapshot = args.asOf ? `_${args.asOf.slice(0, 7)}` : ''
  const filename = `Unrealized_${args.entity}${snapshot}_${date}${filtered}.xlsx`
  XLSX.writeFile(wb, filename)
}

// ── Sheet 1: Positions (group-level, what the table shows) ─────────────────
export function buildPositionsSheet(args: ExportArgs): XLSX.WorkSheet {
  const isSnapshot = !!args.asOf
  const header = [
    'Wallet', 'Wallet Address', 'Token',
    'Acq Date Min', 'Acq Date Max', 'Avg Cost / Unit',
    'Qty', 'Cost Basis (USD)',
    'Current Price', 'Current Value (USD)',
    ...(isSnapshot ? ['Prior Price', 'Prior Value (USD)', 'Δ Month (USD)'] : []),
    'Unrealized G/L (USD)', 'Return %', 'Lot Count',
  ]
  const data = args.positions.map(p => [
    p.wallet,
    p.walletAddr,
    p.asset,
    p.acqDateMin,
    p.acqDateMax,
    p.avgCostPerUnit,
    p.qty,
    p.costBasis,
    p.currentPrice ?? '',
    p.currentValue ?? '',
    ...(isSnapshot
      ? [p.priorPrice ?? '', p.priorValue ?? '', p.deltaMonth ?? '']
      : []),
    p.unrealGain ?? '',
    p.returnPct == null ? '' : p.returnPct,
    p.lotCount,
  ])

  const totalQty = args.positions.reduce((s, p) => s + p.qty, 0)
  const totalCost = args.positions.reduce((s, p) => s + p.costBasis, 0)
  const totalValue = args.positions.reduce((s, p) => s + (p.currentValue ?? 0), 0)
  const totalPriorValue = args.positions.reduce((s, p) => s + (p.priorValue ?? 0), 0)
  const totalDelta = args.positions.reduce((s, p) => s + (p.deltaMonth ?? 0), 0)
  const totalGain = args.positions.reduce((s, p) => s + (p.unrealGain ?? 0), 0)
  const totalReturnPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

  const totalRow: (string | number)[] = [
    'TOTAL', '', '',
    '', '', '',
    totalQty, totalCost,
    '', totalValue,
    ...(isSnapshot ? ['', totalPriorValue, totalDelta] : []),
    totalGain, totalReturnPct, '',
  ]
  data.push(totalRow)

  return XLSX.utils.aoa_to_sheet([
    [`Generated: ${args.computedAt} UTC${args.asOf ? ` · As of ${args.asOf}` : ' · Live'}`],
    [],
    header,
    ...data,
  ])
}

// ── Sheet 2: Lots Detail ───────────────────────────────────────────────────
export function buildLotsDetailSheet(args: ExportArgs): XLSX.WorkSheet {
  const header = [
    'Wallet', 'Wallet Address', 'Token',
    'Acq Date', 'Cost / Unit', 'Qty', 'Cost Basis (USD)',
    'Current Price', 'Current Value (USD)',
    'Unrealized G/L (USD)', 'Return %',
  ]
  const data = args.lots.map(l => [
    l.wallet,
    l.walletAddr,
    l.asset,
    l.acqDate,
    l.costPerUnit,
    l.qty,
    l.costBasis,
    l.currentPrice ?? '',
    l.currentValue ?? '',
    l.unrealGain ?? '',
    l.returnPct == null ? '' : l.returnPct,
  ])

  const totalQty = args.lots.reduce((s, l) => s + l.qty, 0)
  const totalCost = args.lots.reduce((s, l) => s + l.costBasis, 0)
  const totalValue = args.lots.reduce((s, l) => s + (l.currentValue ?? 0), 0)
  const totalGain = args.lots.reduce((s, l) => s + (l.unrealGain ?? 0), 0)
  data.push([
    'TOTAL', '', '',
    '', '', totalQty, totalCost,
    '', totalValue,
    totalGain, '',
  ])

  return XLSX.utils.aoa_to_sheet([
    [`Generated: ${args.computedAt} UTC${args.asOf ? ` · As of ${args.asOf}` : ' · Live'}`],
    [],
    header,
    ...data,
  ])
}
