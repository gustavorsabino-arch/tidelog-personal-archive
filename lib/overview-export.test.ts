import { test, expect } from 'bun:test'
import * as XLSX from 'xlsx'
import { buildOverviewWorkbook } from './overview-export'
import type { TreasuryOverview, TreasuryOverviewWallet } from './types'

function makeWallet(partial: Partial<TreasuryOverviewWallet> & {
  address: string
  label: string
  entity: string
}): TreasuryOverviewWallet {
  return {
    address: partial.address,
    label: partial.label,
    chain: partial.chain ?? 'solana',
    entity: partial.entity,
    accountCode: null,
    isExternal: false,
    balances: partial.balances ?? {},
    tokenUsd: partial.tokenUsd ?? {},
    totalUSD: partial.totalUSD ?? 0,
  }
}

const fixture: TreasuryOverview = {
  snapshotDate: '2026-05-26',
  fetchedAt: null,
  wallets: [
    makeWallet({
      address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      label: 'Foundation Multisig',
      entity: 'Foundation',
      balances: { USDC: 1_250_000, SOL: 4_210.5832, JUNK: 0 },
      tokenUsd: { USDC: 1_250_000, SOL: 632_158.42, JUNK: 0 },
      totalUSD: 1_882_158.42,
    }),
    makeWallet({
      address: '0xAbCdEf0123456789abcdef0123456789ABCDEF01',
      label: 'Opco Hot Wallet',
      entity: 'Opco',
      balances: { USDC: 50_000, ORCA: 12_500.5 },
      tokenUsd: { USDC: 50_000, ORCA: 31_876.25 },
      totalUSD: 81_876.25,
    }),
    makeWallet({
      address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      label: 'Opco Cold',
      entity: 'Opco',
      balances: { SOL: 100 },
      tokenUsd: { SOL: 15_010 },
      totalUSD: 15_010,
    }),
    makeWallet({
      address: 'JukuWalletAddressJukuWalletAddressJukuW1',
      label: 'Juku Treasury',
      entity: 'Juku',
      balances: { USDC: 8_500 },
      tokenUsd: { USDC: 8_500 },
      totalUSD: 8_500,
    }),
    // Zagreus intentionally has no wallets — sheet should still exist.
  ],
  entityTotals: {},
  tokenTotals: {},
  grandTotalUSD: 1_987_544.67,
  prices: {},
}

function sheetRows(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
}

test('workbook has exactly 5 sheets in correct order', () => {
  const wb = buildOverviewWorkbook(fixture)
  expect(wb.SheetNames).toEqual(['All', 'Opco', 'Foundation', 'Juku', 'Zagreus'])
})

test('header row matches the 6-column spec on every sheet', () => {
  const wb = buildOverviewWorkbook(fixture)
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[name])
    expect(rows[0]).toEqual([
      'Wallet name', 'Wallet address', 'Asset', 'Asset Qty', 'Spot Price', 'USD Value',
    ])
  }
})

test('All sheet contains every (wallet, asset) pair with qty > 0', () => {
  const wb = buildOverviewWorkbook(fixture)
  const rows = sheetRows(wb.Sheets.All).slice(1) // drop header
  // 2 from Foundation (USDC, SOL; JUNK excluded), 2 from Opco hot (USDC, ORCA),
  // 1 from Opco cold (SOL), 1 from Juku (USDC) = 6 data rows
  expect(rows).toHaveLength(6)
})

test('zero-qty rows are excluded', () => {
  const wb = buildOverviewWorkbook(fixture)
  const rows = sheetRows(wb.Sheets.All).slice(1)
  // JUNK had qty 0 on Foundation wallet — should not appear
  const assets = rows.map(r => r[2])
  expect(assets).not.toContain('JUNK')
})

test('rows are sorted by USD Value descending within each sheet', () => {
  const wb = buildOverviewWorkbook(fixture)
  const rows = sheetRows(wb.Sheets.All).slice(1)
  const usdValues = rows.map(r => r[5] as number)
  for (let i = 1; i < usdValues.length; i++) {
    expect(usdValues[i]).toBeLessThanOrEqual(usdValues[i - 1])
  }
})

test('per-entity sheets only contain that entity\'s wallets', () => {
  const wb = buildOverviewWorkbook(fixture)
  const opcoRows = sheetRows(wb.Sheets.Opco).slice(1)
  const opcoLabels = new Set(opcoRows.map(r => r[0]))
  expect(opcoLabels).toEqual(new Set(['Opco Hot Wallet', 'Opco Cold']))

  const foundationRows = sheetRows(wb.Sheets.Foundation).slice(1)
  const foundationLabels = new Set(foundationRows.map(r => r[0]))
  expect(foundationLabels).toEqual(new Set(['Foundation Multisig']))
})

test('empty entity still gets a sheet with header only', () => {
  const wb = buildOverviewWorkbook(fixture)
  const zagreusRows = sheetRows(wb.Sheets.Zagreus)
  expect(zagreusRows).toHaveLength(1) // just the header
  expect(zagreusRows[0]).toEqual([
    'Wallet name', 'Wallet address', 'Asset', 'Asset Qty', 'Spot Price', 'USD Value',
  ])
})

test('address column is text-typed and wide enough not to truncate', () => {
  const wb = buildOverviewWorkbook(fixture)
  const ws = wb.Sheets.All
  // Cell B2 (first data row, wallet address column)
  const addrCell = ws['B2']
  expect(addrCell.t).toBe('s')
  expect(addrCell.z).toBe('@')
  // Column widths set explicitly
  expect(ws['!cols']).toBeDefined()
  expect(ws['!cols']![1].wch).toBeGreaterThanOrEqual(46)
})

test('Asset Qty, Spot Price, and USD Value cells are stored as numbers (so Excel SUM works)', () => {
  const wb = buildOverviewWorkbook(fixture)
  const ws = wb.Sheets.All
  // Column D = Asset Qty, Column E = Spot Price, Column F = USD Value
  expect(ws['D2'].t).toBe('n')
  expect(ws['E2'].t).toBe('n')
  expect(ws['F2'].t).toBe('n')
})

test('Asset Qty, Spot Price, and USD Value all render with exactly 2 decimals', () => {
  const wb = buildOverviewWorkbook(fixture)
  const ws = wb.Sheets.All
  expect(ws['D2'].z).toBe('#,##0.00')
  expect(ws['E2'].z).toBe('#,##0.00')
  expect(ws['F2'].z).toBe('#,##0.00')
})

test('Spot Price equals USD Value divided by Asset Qty', () => {
  const wb = buildOverviewWorkbook(fixture)
  const rows = sheetRows(wb.Sheets.All).slice(1)
  for (const row of rows) {
    const qty = row[3] as number
    const spot = row[4] as number
    const usd = row[5] as number
    expect(spot).toBeCloseTo(usd / qty, 10)
  }
})
