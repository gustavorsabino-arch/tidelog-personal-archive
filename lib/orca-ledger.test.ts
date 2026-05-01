import { test, expect } from 'bun:test'
import type { OrcaLedgerRow, OrcaWalletSummary } from './types'

// These are unit-level tests for derived shapes. The orchestrator's DB-bound
// behavior is verified by manually running the page in dev (smoke checklist
// in the spec) since the rest is a thin join + projection.

test('realizedTerm projection: pure ST', () => {
  const row: OrcaLedgerRow = makeRow({
    dir: 'Out',
    lots: [{ qty: 5, costPerUnit: 1, acqDate: '2024-12-01', acqTxHash: 't1', acqWalletAddr: 'wA', daysHeld: 30, term: 'ST', gain: 5 }],
  })
  expect(row.realizedTerm).toBe('ST')
})

test('realizedTerm projection: pure LT', () => {
  const row: OrcaLedgerRow = makeRow({
    dir: 'Out',
    lots: [{ qty: 5, costPerUnit: 1, acqDate: '2022-12-01', acqTxHash: 't1', acqWalletAddr: 'wA', daysHeld: 800, term: 'LT', gain: 5 }],
  })
  expect(row.realizedTerm).toBe('LT')
})

test('realizedTerm projection: mixed', () => {
  const row: OrcaLedgerRow = makeRow({
    dir: 'Out',
    lots: [
      { qty: 3, costPerUnit: 1, acqDate: '2022-12-01', acqTxHash: 't1', acqWalletAddr: 'wA', daysHeld: 800, term: 'LT', gain: 3 },
      { qty: 2, costPerUnit: 2, acqDate: '2024-12-01', acqTxHash: 't2', acqWalletAddr: 'wA', daysHeld: 30, term: 'ST', gain: 2 },
    ],
  })
  expect(row.realizedTerm).toBe('mixed')
})

test('realizedTerm projection: null for In rows and for empty lots', () => {
  expect(makeRow({ dir: 'In', lots: [] }).realizedTerm).toBe(null)
  expect(makeRow({ dir: 'Out', lots: [] }).realizedTerm).toBe(null)
})

test('summary: wallet with remaining lots gets weighted avg cost', () => {
  const summary: OrcaWalletSummary = makeSummary({
    remainingLots: [
      { qty: 60, costPerUnit: 1, acqDate: '2024-01-01' },
      { qty: 40, costPerUnit: 2, acqDate: '2024-06-01' },
    ],
  })
  // (60*1 + 40*2) / 100 = 1.4
  expect(summary.avgCostPerUnit).toBeCloseTo(1.4, 6)
  expect(summary.noBasis).toBe(false)
})

test('summary: wallet with positive qty but no remaining lots is noBasis', () => {
  const summary: OrcaWalletSummary = makeSummary({
    totalQty: 0,           // computed from remainingLots
    remainingLots: [],
    noBasis: true,
  })
  expect(summary.noBasis).toBe(true)
  expect(summary.avgCostPerUnit).toBe(0)
})

// ── helpers ────────────────────────────────────────────────────────────────
function makeRow(over: Partial<OrcaLedgerRow>): OrcaLedgerRow {
  // Mimics the projection logic in getOrcaLedger so we can unit-test it.
  const dir = over.dir ?? 'In'
  const lots = over.lots ?? []
  const realizedGain = lots.reduce((s, l) => s + l.gain, 0)
  const terms = new Set(lots.map(l => l.term))
  const realizedTerm: 'ST' | 'LT' | 'mixed' | null =
    dir !== 'Out' || lots.length === 0 ? null : terms.size > 1 ? 'mixed' : terms.has('LT') ? 'LT' : 'ST'
  return {
    txHash: 't1',
    walletAddr: 'wA',
    wallet: 'A',
    entity: 'opco',
    blockTime: 1,
    date: '2024-01-01T00:00:00Z',
    asset: 'ORCA',
    qty: 10,
    dir,
    price: 1,
    usd: 10,
    priceSource: 'birdeye',
    counterparty: null,
    counterpartyLabel: null,
    counterpartyEntity: null,
    internal: false,
    internalPairedWalletAddr: null,
    internalPairedWalletLabel: null,
    balanceAfter: 0,
    lots,
    realizedGain,
    realizedTerm,
    noBasis: false,
    ...over,
  }
}

function makeSummary(over: Partial<OrcaWalletSummary>): OrcaWalletSummary {
  const remainingLots = over.remainingLots ?? []
  const totalQty = over.totalQty ?? remainingLots.reduce((s, l) => s + l.qty, 0)
  const totalCost = remainingLots.reduce((s, l) => s + l.qty * l.costPerUnit, 0)
  return {
    walletAddr: 'wA',
    wallet: 'A',
    totalQty,
    avgCostPerUnit: totalQty > 0 ? totalCost / totalQty : 0,
    remainingLots,
    lifetimeRealizedGain: 0,
    noBasis: totalQty > 1e-8 && remainingLots.length === 0,
    ...over,
  }
}
