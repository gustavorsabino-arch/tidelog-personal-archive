import { test, expect } from 'bun:test'
import { buildLedgerSheet, buildLotsDetailSheet, buildWalletSummarySheet } from './orca-ledger-export'
import type { OrcaLedgerRow, OrcaWalletSummary } from './types'
import * as XLSX from 'xlsx'

const baseArgs = {
  computedAt: '2026-04-30T14:00:00.000Z',
  entity: 'Opco',
  activeFilters: {},
}

const sampleRow: OrcaLedgerRow = {
  txHash: 'tx1', walletAddr: 'wA', wallet: 'WalletA', entity: 'opco',
  blockTime: 1700000000, date: '2023-11-14T22:13:20Z', asset: 'ORCA',
  qty: 100, dir: 'Out', price: 2, usd: 200, priceSource: 'birdeye',
  counterparty: 'cp1', counterpartyLabel: null, counterpartyEntity: null,
  internal: false, internalPairedWalletAddr: null, balanceAfter: 0,
  lots: [
    { qty: 60, costPerUnit: 1, acqDate: '2023-01-01', acqTxHash: 't0a', acqWalletAddr: 'wA', daysHeld: 300, term: 'ST', gain: 60 },
    { qty: 40, costPerUnit: 1.5, acqDate: '2023-06-01', acqTxHash: 't0b', acqWalletAddr: 'wA', daysHeld: 160, term: 'ST', gain: 20 },
  ],
  realizedGain: 80, realizedTerm: 'ST', noBasis: false,
}

const sampleSummary: OrcaWalletSummary = {
  walletAddr: 'wA', wallet: 'WalletA', totalQty: 50, avgCostPerUnit: 1.2,
  remainingLots: [{ qty: 50, costPerUnit: 1.2, acqDate: '2024-01-01' }],
  lifetimeRealizedGain: 80, noBasis: false,
}

test('Ledger sheet has header + data + total rows', () => {
  const ws = buildLedgerSheet({ ...baseArgs, rows: [sampleRow], summaryByWallet: { wA: sampleSummary } })
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })
  // Row 0: timestamp banner; Row 1: blank; Row 2: header
  expect(aoa[2][0]).toBe('Date')
  // Last row: TOTAL
  expect(aoa[aoa.length - 1][0]).toBe('TOTAL')
})

test('Lots Detail sheet has one row per LotTraceEntry', () => {
  const ws = buildLotsDetailSheet({ ...baseArgs, rows: [sampleRow], summaryByWallet: {} })
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })
  // 3 banner rows (timestamp, blank, header) + 2 data rows + 1 total
  expect(aoa).toHaveLength(6)
  expect(aoa[3][4]).toBe(1) // first lot index
  expect(aoa[4][4]).toBe(2) // second lot index
})

test('Wallet Summary sheet renders summary entries', () => {
  const ws = buildWalletSummarySheet({ ...baseArgs, rows: [], summaryByWallet: { wA: sampleSummary } })
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })
  expect(aoa[3][1]).toBe('wA')
  expect(aoa[3][2]).toBe(50)
})
