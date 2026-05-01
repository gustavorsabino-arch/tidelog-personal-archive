import * as XLSX from 'xlsx'
import type { OrcaLedgerRow, OrcaWalletSummary } from '@/lib/types'

interface ExportArgs {
  rows: OrcaLedgerRow[]
  summaryByWallet: Record<string, OrcaWalletSummary>
  computedAt: string
  entity: string
  activeFilters: { dir?: string; type?: string; year?: string; month?: string; wallet?: string }
}

// Public: build an .xlsx workbook in-browser and trigger download.
// Browser-only (uses XLSX.writeFile which calls saveAs under the hood).
export function exportOrcaLedgerXLSX(args: ExportArgs): void {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildLedgerSheet(args), 'Ledger')
  XLSX.utils.book_append_sheet(wb, buildLotsDetailSheet(args), 'Lots Detail')
  XLSX.utils.book_append_sheet(wb, buildWalletSummarySheet(args), 'Wallet Summary')

  const filtered = Object.values(args.activeFilters).some(v => !!v) ? '_filtered' : ''
  const date = new Date().toISOString().slice(0, 10)
  const filename = `OrcaLedger_${args.entity}_${date}${filtered}.xlsx`
  XLSX.writeFile(wb, filename)
}

// ── Sheet 1: Ledger ────────────────────────────────────────────────────────
export function buildLedgerSheet(args: ExportArgs): XLSX.WorkSheet {
  const header = [
    'Date', 'Wallet', 'Wallet Address', 'Direction', 'Qty', 'Price', 'USD',
    'Balance After', 'Counterparty', 'Counterparty Address', 'Type',
    'Lots Summary', 'Realized Gain', 'Realized Term', 'Tx Hash',
  ]
  const data = args.rows.map(r => [
    r.date,
    r.wallet,
    r.walletAddr,
    r.dir,
    r.qty,
    r.price,
    r.usd,
    r.balanceAfter,
    r.counterpartyLabel ?? r.counterparty ?? '',
    r.counterparty ?? '',
    r.priceSource === 'genesis' ? 'GENESIS' : r.internal ? 'INTERNAL' : 'EXTERNAL',
    summarizeLots(r),
    r.realizedGain,
    r.realizedTerm ?? '',
    r.txHash,
  ])

  // Total row
  const totalIn = args.rows.filter(r => r.dir === 'In').reduce((s, r) => s + r.qty, 0)
  const totalOut = args.rows.filter(r => r.dir === 'Out').reduce((s, r) => s + r.qty, 0)
  const totalUsd = args.rows.reduce((s, r) => s + (r.usd ?? 0), 0)
  const totalGain = args.rows.reduce((s, r) => s + r.realizedGain, 0)
  data.push(['TOTAL', '', '', `In: ${totalIn} · Out: ${totalOut}`, '', '', totalUsd, '', '', '', '', '', totalGain, '', ''])

  const ws = XLSX.utils.aoa_to_sheet([
    [`Generated: ${args.computedAt} UTC`],
    [],
    header,
    ...data,
  ])
  return ws
}

// ── Sheet 2: Lots Detail ───────────────────────────────────────────────────
export function buildLotsDetailSheet(args: ExportArgs): XLSX.WorkSheet {
  const header = [
    'Ledger Tx Hash', 'Ledger Date', 'Ledger Wallet', 'Ledger Dir',
    'Lot Index', 'Lot Qty', 'Cost / Unit', 'Cost Basis',
    'Acq Date', 'Acq Tx Hash', 'Acq Wallet', 'Days Held', 'Term', 'Realized Gain',
  ]
  const data: (string | number)[][] = []
  for (const r of args.rows) {
    r.lots.forEach((l, idx) => {
      data.push([
        r.txHash, r.date, r.wallet, r.dir,
        idx + 1, l.qty, l.costPerUnit, l.qty * l.costPerUnit,
        l.acqDate, l.acqTxHash, l.acqWalletAddr, l.daysHeld, l.term, l.gain,
      ])
    })
  }
  const totalQty = data.reduce((s, row) => s + (row[5] as number), 0)
  const totalCost = data.reduce((s, row) => s + (row[7] as number), 0)
  const totalGain = data.reduce((s, row) => s + (row[13] as number), 0)
  data.push(['TOTAL', '', '', '', '', totalQty, '', totalCost, '', '', '', '', '', totalGain])
  return XLSX.utils.aoa_to_sheet([
    [`Generated: ${args.computedAt} UTC`],
    [],
    header,
    ...data,
  ])
}

// ── Sheet 3: Wallet Summary ────────────────────────────────────────────────
export function buildWalletSummarySheet(args: ExportArgs): XLSX.WorkSheet {
  const header = [
    'Wallet', 'Wallet Address', 'Remaining Qty', 'Avg Cost',
    'Cost Basis (USD)', 'Open Lots', 'Lifetime Realized G/L', 'No-Basis Flag',
  ]
  const data = Object.values(args.summaryByWallet).map(s => [
    s.wallet,
    s.walletAddr,
    s.totalQty,
    s.avgCostPerUnit,
    s.totalQty * s.avgCostPerUnit,
    s.remainingLots.length,
    s.lifetimeRealizedGain,
    s.noBasis ? 'YES' : '',
  ])
  return XLSX.utils.aoa_to_sheet([
    [`Generated: ${args.computedAt} UTC`],
    [],
    header,
    ...data,
  ])
}

// ── Helpers ────────────────────────────────────────────────────────────────
function summarizeLots(r: OrcaLedgerRow): string {
  if (r.lots.length === 0) return r.dir === 'Out' ? 'no basis' : ''
  if (r.dir === 'In' && r.internal) return `↤ ${r.lots.length} lot(s)`
  if (r.dir === 'In') return `+lot @ ${r.lots[0].costPerUnit.toFixed(4)}`
  if (r.internal) return `↦ ${r.lots.length} lot(s)`
  if (r.lots.length <= 2) return r.lots.map(l => `${l.qty.toFixed(2)}@${l.costPerUnit.toFixed(4)}`).join(', ')
  const totalQty = r.lots.reduce((s, l) => s + l.qty, 0)
  const totalCost = r.lots.reduce((s, l) => s + l.qty * l.costPerUnit, 0)
  return `${r.lots.length} lots · avg $${(totalQty > 0 ? totalCost / totalQty : 0).toFixed(4)}`
}
