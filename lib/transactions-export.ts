import * as XLSX from 'xlsx'
import type { Transaction } from '@/lib/types'
import { ENTITIES } from '@/lib/constants'

/**
 * Serialize QB-posted transactions to a workbook, one sheet per entity when
 * multiple entities are supplied (matches the pattern in lib/overview-export.ts).
 *
 * Column set focuses on what an accountant closing a month cares about:
 * date, tx hash, wallet, direction, asset, qty, price, USD, counterparty,
 * effective GL account/vendor/class, QB doc / journal entry references, and
 * realized gains. Tx hash is written as text-typed so Excel doesn't mangle
 * long base58/EVM strings.
 */

export type PostedTxExportRow = Transaction

type BuildOpts = {
  // Map of entity display name → txns for that entity. If a single entry,
  // the workbook has one sheet named after that entity. If multiple, one
  // sheet per entity in ENTITIES order (skipping empty).
  txnsByEntity: Record<string, PostedTxExportRow[]>
  // Per-entity map of GL account number → account name (from the QB account
  // catalog) so the DR/CR columns can show full names ("113603 · Digital
  // assets - USDC") instead of bare numbers. Optional — missing entries
  // degrade to the bare number.
  accountNamesByEntity?: Record<string, Record<string, string>>
  // Human label shown in the sheet-not-empty case; useful for period context.
  periodLabel?: string
}

const HEADER: readonly string[] = [
  'Date',
  'Tx Hash',
  'Wallet',
  'Direction',
  'Asset',
  'Qty',
  'Price',
  'USD',
  'Counterparty',
  'Counterparty Label',
  'DR Account',
  'DR Amount',
  'CR Account',
  'CR Amount',
  'Effective Vendor',
  'Effective Class',
  'QB Doc #',
  'QB Journal Entry ID',
  'QB Status',
  'Description',
  'ST Gain',
  'LT Gain',
]

// Column widths tuned to what each field typically holds. Tx hash + JE ID
// get extra space; qty/price/USD are numeric so narrower is fine.
const COL_WIDTHS = [
  { wch: 12 },  // Date
  { wch: 46 },  // Tx Hash
  { wch: 24 },  // Wallet
  { wch: 10 },  // Direction
  { wch: 8 },   // Asset
  { wch: 14 },  // Qty
  { wch: 12 },  // Price
  { wch: 14 },  // USD
  { wch: 22 },  // Counterparty
  { wch: 22 },  // Counterparty Label
  { wch: 34 },  // DR Account
  { wch: 14 },  // DR Amount
  { wch: 34 },  // CR Account
  { wch: 14 },  // CR Amount
  { wch: 18 },  // Effective Vendor
  { wch: 16 },  // Effective Class
  { wch: 14 },  // QB Doc #
  { wch: 22 },  // QB Journal Entry ID
  { wch: 12 },  // QB Status
  { wch: 44 },  // Description
  { wch: 12 },  // ST Gain
  { wch: 12 },  // LT Gain
]

// Excel's sheet-name constraints — forbidden chars + 31-char cap. Reused from
// budget-export.ts pattern (kept inline to avoid an import that would drag
// budget deps into transactions-export).
function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim()
  return cleaned.length > 31 ? cleaned.slice(0, 31) : (cleaned || 'Sheet')
}

export function buildPostedTransactionsWorkbook(opts: BuildOpts): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  // Preserve ENTITIES order — Opco / Foundation / Juku / Zagreus. Skip empty.
  const orderedEntities = [...ENTITIES].filter((e) => (opts.txnsByEntity[e]?.length ?? 0) > 0)
  const entitiesToWrite = orderedEntities.length > 0
    ? orderedEntities
    : Object.keys(opts.txnsByEntity)

  if (entitiesToWrite.length === 0) {
    // Emit a single empty-header sheet so the download isn't a zero-sheet
    // workbook (Excel refuses to open those).
    XLSX.utils.book_append_sheet(wb, buildSheet([], {}), 'Empty')
    return wb
  }

  for (const entity of entitiesToWrite) {
    const txns = opts.txnsByEntity[entity] ?? []
    const nameMap = opts.accountNamesByEntity?.[entity] ?? {}
    XLSX.utils.book_append_sheet(wb, buildSheet(txns, nameMap), sanitizeSheetName(entity))
  }
  return wb
}

// "62010" → "62010 · Professional Services" when the catalog knows the name;
// bare number otherwise; empty string for null.
function accountFullName(num: string | null | undefined, nameMap: Record<string, string>): string {
  if (!num) return ''
  const name = nameMap[num]
  return name ? `${num} · ${name}` : num
}

function buildSheet(txns: PostedTxExportRow[], nameMap: Record<string, string>): XLSX.WorkSheet {
  // aoa_to_sheet: header + all body rows in one shot. Header on row 1, body
  // starting row 2 — matches the pattern in lib/budget/budget-export.ts.
  const rows: (string | number | null)[][] = txns.map((t) => {
    // DR/CR mirror the journal entry's main pair (lib/qb/post-journal-entry.ts):
    // inflow = Debit wallet GL / Credit counterparty GL; outflow = the reverse.
    // Both legs carry the same USD amount (ST/LT gains are separate columns).
    // Wallet side: effectiveGlAccount (posted snapshot for posted rows).
    // Counterparty side: per-tx override, else the counterparty GL mapping.
    const walletGl = t.effectiveGlAccount || null
    const cpGl = t.counterpartyGlOverride || t.counterpartyGlAccount || null
    const isIn = (t.dir || '').toLowerCase() === 'in'
    const drAccount = accountFullName(isIn ? walletGl : cpGl, nameMap)
    const crAccount = accountFullName(isIn ? cpGl : walletGl, nameMap)
    const usd = t.usd === null || t.usd === undefined ? '' : Number(t.usd)

    // Kate: "description should also include vendor" — append when it isn't
    // already part of the text.
    const baseDesc = t.description || t.descriptionDefault || ''
    const vendor = t.effectiveVendor || ''
    const description = vendor && !baseDesc.toLowerCase().includes(vendor.toLowerCase())
      ? (baseDesc ? `${baseDesc} — ${vendor}` : vendor)
      : baseDesc

    return [
      // Date as string (ISO trimmed to YYYY-MM-DD) — matches how buildTransactionsWorkbook
      // in budget-export.ts handles dates (server serializes as ISO string; converting
      // to Excel Date cell would flip formatting depending on the operator's locale).
      t.date ? String(t.date).slice(0, 10) : '',
      t.txHash || '',
      t.wallet || t.walletAddr || '',
      t.dir || '',
      t.asset || '',
      typeof t.qty === 'number' ? t.qty : (t.qty ? Number(t.qty) : 0),
      t.price === null || t.price === undefined ? '' : Number(t.price),
      usd,
      t.counterparty || '',
      t.counterpartyLabel || '',
      drAccount,
      usd,
      crAccount,
      usd,
      t.effectiveVendor || '',
      t.effectiveClass || '',
      t.qbDocNumber || '',
      t.qbJournalEntryId || '',
      t.qbPostingStatus || '',
      description,
      typeof t.stGain === 'number' ? t.stGain : (t.stGain ? Number(t.stGain) : ''),
      typeof t.ltGain === 'number' ? t.ltGain : (t.ltGain ? Number(t.ltGain) : ''),
    ]
  })

  const ws = XLSX.utils.aoa_to_sheet([[...HEADER], ...rows])

  // Text-type Tx Hash column (index 1 = col B) — keeps Excel from mangling
  // long base58 / 0x… strings when the sheet is reopened.
  for (let i = 0; i < txns.length; i++) {
    const ref = XLSX.utils.encode_cell({ c: 1, r: i + 1 })
    const cell = ws[ref]
    if (cell) {
      cell.t = 's'
      cell.z = '@'
    }
  }

  // Currency format for Price (6), USD (7), DR Amount (11), CR Amount (13),
  // ST Gain (20), LT Gain (21). Qty (5) uses generic number format because
  // different assets have different decimal precision.
  const currencyCols = [6, 7, 11, 13, 20, 21]
  const qtyCol = 5
  for (let r = 1; r <= rows.length; r++) {
    for (const c of currencyCols) {
      const ref = XLSX.utils.encode_cell({ c, r })
      const cell = ws[ref]
      if (cell && typeof cell.v === 'number') {
        cell.z = '$#,##0.00;-$#,##0.00'
      }
    }
    const qtyRef = XLSX.utils.encode_cell({ c: qtyCol, r })
    const qtyCell = ws[qtyRef]
    if (qtyCell && typeof qtyCell.v === 'number') {
      qtyCell.z = '#,##0.00######'
    }
  }

  ws['!cols'] = [...COL_WIDTHS]
  // Freeze the header row so scrolling keeps it visible — same pattern the
  // budget workbook uses.
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }

  return ws
}

/**
 * Filename builder: tidelog-transactions-<entity-slug>-<year>-<month>.xlsx
 *   e.g. tidelog-transactions-opco-2026-07.xlsx
 *        tidelog-transactions-all-entities-2026-07.xlsx
 */
export function buildPostedTxExportFilename(opts: {
  entityLabel: string       // 'Opco' | ... | 'All entities'
  year: number
  month: number             // 1..12
}): string {
  const entitySlug = slugify(opts.entityLabel)
  const monthPadded = String(opts.month).padStart(2, '0')
  return `tidelog-transactions-${entitySlug}-${opts.year}-${monthPadded}.xlsx`
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
