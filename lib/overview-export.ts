import * as XLSX from 'xlsx'
import { ENTITIES } from '@/lib/constants'
import type { TreasuryOverview, TreasuryOverviewWallet } from '@/lib/types'

interface Row {
  walletName: string
  walletAddr: string
  asset: string
  qty: number
  usd: number
}

const HEADER = ['Wallet name', 'Wallet address', 'Asset', 'Asset Qty', 'USD Value']

// Column widths: name, address (wide enough for 44-char base58 + margin), asset, qty, usd.
const COL_WIDTHS = [{ wch: 28 }, { wch: 46 }, { wch: 8 }, { wch: 18 }, { wch: 16 }]

export function buildOverviewWorkbook(data: TreasuryOverview): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildSheet(data.wallets), 'All')
  for (const entity of ENTITIES) {
    const wallets = data.wallets.filter(w => w.entity === entity)
    XLSX.utils.book_append_sheet(wb, buildSheet(wallets), entity)
  }
  return wb
}

function buildSheet(wallets: TreasuryOverviewWallet[]): XLSX.WorkSheet {
  const rows: Row[] = []
  for (const w of wallets) {
    for (const [asset, qty] of Object.entries(w.balances)) {
      if (!qty || qty <= 0) continue
      rows.push({
        walletName: w.label,
        walletAddr: w.address,
        asset,
        qty,
        usd: w.tokenUsd[asset] ?? 0,
      })
    }
  }
  rows.sort((a, b) => b.usd - a.usd)

  const ws = XLSX.utils.aoa_to_sheet([HEADER])
  // Append data rows starting at row 2 (index 1). Use sheet_add_aoa so we can
  // post-process cells; then we override the address column to text-typed.
  XLSX.utils.sheet_add_aoa(
    ws,
    rows.map(r => [r.walletName, r.walletAddr, r.asset, r.qty, r.usd]),
    { origin: 'A2' },
  )

  // Force address cells to be string type with text format ('@'), so Excel
  // never auto-reformats long base58 strings or 0x… EVM addresses.
  for (let i = 0; i < rows.length; i++) {
    const cellRef = XLSX.utils.encode_cell({ c: 1, r: i + 1 }) // column B, row i+1 (0-indexed)
    ws[cellRef] = { t: 's', v: rows[i].walletAddr, z: '@' }
  }

  // Apply number formats to Asset Qty (col D) and USD Value (col E).
  for (let i = 0; i < rows.length; i++) {
    const qtyRef = XLSX.utils.encode_cell({ c: 3, r: i + 1 })
    const usdRef = XLSX.utils.encode_cell({ c: 4, r: i + 1 })
    if (ws[qtyRef]) ws[qtyRef].z = '#,##0.00'
    if (ws[usdRef]) ws[usdRef].z = '#,##0.00'
  }

  ws['!cols'] = COL_WIDTHS
  return ws
}
