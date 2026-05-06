/**
 * Tests for getTreasuryUnrealized.
 *
 * The DB call (`getTreasuryTransactionsAsc`) and price calls
 * (`getCurrentPrices`, `getHistoricalPrice`) are mocked at the module
 * boundary; everything else is exercised end-to-end so we lock down
 * snapshot semantics, genesis basis flow, and prior-month delta logic.
 */
import { test, expect, mock, beforeEach } from 'bun:test'
import type { Transaction } from './types'

// Mocks must be installed before importing the module under test.
let mockTxs: Transaction[] = []
let mockCurrentPrices: Record<string, number> = {}
let mockHistoricalPrices: Record<string, Record<number, number>> = {}

mock.module('@/lib/treasury-transactions', () => ({
  getTreasuryTransactionsAsc: async () => mockTxs,
}))
mock.module('@/lib/defillama', () => ({
  getCurrentPrices: async (tokens?: string[]) => {
    if (!tokens) return mockCurrentPrices
    const out: Record<string, number> = {}
    for (const t of tokens) if (mockCurrentPrices[t] != null) out[t] = mockCurrentPrices[t]
    return out
  },
  getHistoricalPrice: async (token: string, ts: number) => {
    return mockHistoricalPrices[token]?.[ts] ?? null
  },
}))

const { getTreasuryUnrealized } = await import('./treasury-unrealized')

beforeEach(() => {
  mockTxs = []
  mockCurrentPrices = {}
  mockHistoricalPrices = {}
})

function tx(over: Partial<Transaction>): Transaction {
  return {
    txHash: 'tx',
    walletAddr: 'wA',
    wallet: 'WalletA',
    entity: 'Foundation',
    blockTime: 0,
    date: '2024-01-01T00:00:00Z',
    asset: 'ORCA',
    qty: 0,
    dir: 'In',
    price: null,
    usd: null,
    priceSource: null,
    counterparty: null,
    category: null,
    ...over,
  }
}

const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)
// UTC end-of-month timestamps.
const EOM = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split('-').map(Number)
  return Math.floor(Date.UTC(y, m, 0, 23, 59, 59, 999) / 1000)
}

test('genesis tx contributes cost basis to the open position', async () => {
  // Foundation TGE seed: 100 ORCA @ $2 (synthetic). Non-genesis Out of 30 later.
  // Remaining position: 70 ORCA @ $2 cost basis, current price $5.
  mockTxs = [
    tx({
      txHash: 'genesis-orca',
      blockTime: ts('2021-08-09T00:00:00Z'),
      date: '2021-08-09T00:00:00Z',
      qty: 100,
      dir: 'In',
      price: 2,
      priceSource: 'genesis',
    }),
    tx({
      txHash: 't1',
      blockTime: ts('2024-03-15T00:00:00Z'),
      date: '2024-03-15T00:00:00Z',
      qty: 30,
      dir: 'Out',
      price: 4,
      priceSource: 'birdeye',
    }),
  ]
  mockCurrentPrices = { ORCA: 5 }

  const r = await getTreasuryUnrealized({ entity: 'Foundation' })
  expect(r.positions).toHaveLength(1)
  const p = r.positions[0]
  expect(p.asset).toBe('ORCA')
  expect(p.qty).toBeCloseTo(70, 6)
  expect(p.costBasis).toBeCloseTo(140, 6)        // 70 × 2
  expect(p.avgCostPerUnit).toBeCloseTo(2, 6)
  expect(p.currentPrice).toBe(5)
  expect(p.currentValue).toBeCloseTo(350, 6)     // 70 × 5
  expect(p.unrealGain).toBeCloseTo(210, 6)       // 350 − 140
  expect(p.returnPct).toBeCloseTo(150, 4)        // 210/140 × 100
  expect(p.lotCount).toBe(1)
  expect(r.missingPrices).toEqual([])
})

test('without genesis basis, FIFO would have nothing — confirms genesis flows through', async () => {
  // Same sequence but the genesis row excluded. Out-30 has nothing to consume,
  // and position should be empty. This pins the bug we are explicitly fixing.
  mockTxs = [
    tx({
      txHash: 't1',
      blockTime: ts('2024-03-15T00:00:00Z'),
      date: '2024-03-15T00:00:00Z',
      qty: 30,
      dir: 'Out',
      price: 4,
      priceSource: 'birdeye',
    }),
  ]
  mockCurrentPrices = { ORCA: 5 }

  const r = await getTreasuryUnrealized({ entity: 'Foundation' })
  expect(r.positions).toEqual([])
})

test('asOf snapshot ignores transactions after EOM', async () => {
  // In Feb (genesis-style — synthetic basis lot, simpler than real opening),
  // sell in Apr. Snapshot at end of March should show full position; snapshot
  // at end of April should show position minus the April sale.
  mockTxs = [
    tx({
      txHash: 'g',
      blockTime: ts('2024-01-15T00:00:00Z'),
      date: '2024-01-15T00:00:00Z',
      qty: 100,
      dir: 'In',
      price: 2,
      priceSource: 'genesis',
    }),
    tx({
      txHash: 'sell',
      blockTime: ts('2024-04-10T00:00:00Z'),
      date: '2024-04-10T00:00:00Z',
      qty: 40,
      dir: 'Out',
      price: 3,
      priceSource: 'birdeye',
    }),
  ]
  // For asOf, historical price; live is unused for snapshot value but is
  // probed for the table's current price column.
  mockCurrentPrices = { ORCA: 5 }
  mockHistoricalPrices = {
    ORCA: {
      [EOM('2024-03')]: 4,
      [EOM('2024-04')]: 6,
      [EOM('2024-02')]: 3,
      [EOM('2024-03')]: 4,
    },
  }

  const march = await getTreasuryUnrealized({ entity: 'Foundation', asOf: '2024-03' })
  expect(march.positions[0].qty).toBeCloseTo(100, 6)
  expect(march.positions[0].currentPrice).toBe(4)
  expect(march.positions[0].currentValue).toBeCloseTo(400, 6)

  const april = await getTreasuryUnrealized({ entity: 'Foundation', asOf: '2024-04' })
  expect(april.positions[0].qty).toBeCloseTo(60, 6)
  expect(april.positions[0].currentPrice).toBe(6)
  expect(april.positions[0].currentValue).toBeCloseTo(360, 6)
})

test('prior-month delta: position existing in both months', async () => {
  mockTxs = [
    tx({
      txHash: 'g',
      blockTime: ts('2024-01-01T00:00:00Z'),
      date: '2024-01-01T00:00:00Z',
      qty: 100,
      dir: 'In',
      price: 2,
      priceSource: 'genesis',
    }),
  ]
  mockCurrentPrices = { ORCA: 10 }
  mockHistoricalPrices = {
    ORCA: {
      [EOM('2024-04')]: 6,
      [EOM('2024-03')]: 4,
    },
  }

  const r = await getTreasuryUnrealized({ entity: 'Foundation', asOf: '2024-04' })
  const p = r.positions[0]
  expect(p.currentValue).toBeCloseTo(600, 6)   // 100 × 6
  expect(p.priorPrice).toBe(4)
  expect(p.priorValue).toBeCloseTo(400, 6)     // 100 × 4
  expect(p.deltaMonth).toBeCloseTo(200, 6)
})

test('prior-month delta: newly-acquired position has priorValue=0 and deltaMonth=currentValue', async () => {
  mockTxs = [
    tx({
      txHash: 'buy',
      blockTime: ts('2024-04-15T00:00:00Z'),
      date: '2024-04-15T00:00:00Z',
      qty: 50,
      dir: 'In',
      price: 5,
      priceSource: 'birdeye',
    }),
  ]
  mockCurrentPrices = { ORCA: 8 }
  mockHistoricalPrices = {
    ORCA: {
      [EOM('2024-04')]: 7,
      // No price needed for 2024-03 since priorQty=0 short-circuits.
    },
  }

  const r = await getTreasuryUnrealized({ entity: 'Foundation', asOf: '2024-04' })
  const p = r.positions[0]
  expect(p.currentValue).toBeCloseTo(350, 6)   // 50 × 7
  expect(p.priorValue).toBe(0)                 // not held last month
  expect(p.deltaMonth).toBeCloseTo(350, 6)
})

test('missingPrices populated when historical/live price is absent', async () => {
  mockTxs = [
    tx({
      txHash: 'buy',
      blockTime: ts('2024-04-15T00:00:00Z'),
      date: '2024-04-15T00:00:00Z',
      qty: 10,
      dir: 'In',
      price: 5,
      asset: 'WIF',
      priceSource: 'birdeye',
    }),
  ]
  // No price for WIF anywhere.
  const r = await getTreasuryUnrealized({ entity: 'Foundation' })
  expect(r.missingPrices).toContain('WIF')
  const p = r.positions[0]
  expect(p.currentPrice).toBeNull()
  expect(p.currentValue).toBeNull()
  expect(p.unrealGain).toBeNull()
  expect(p.returnPct).toBeNull()
})

test('lots and positions agree on totals', async () => {
  mockTxs = [
    tx({
      txHash: 'g1',
      blockTime: ts('2024-01-01T00:00:00Z'),
      date: '2024-01-01T00:00:00Z',
      qty: 100,
      dir: 'In',
      price: 2,
      priceSource: 'genesis',
    }),
    tx({
      txHash: 'b2',
      blockTime: ts('2024-02-01T00:00:00Z'),
      date: '2024-02-01T00:00:00Z',
      qty: 50,
      dir: 'In',
      price: 4,
      priceSource: 'birdeye',
    }),
  ]
  mockCurrentPrices = { ORCA: 6 }
  const r = await getTreasuryUnrealized({ entity: 'Foundation' })
  expect(r.positions).toHaveLength(1)
  expect(r.lots).toHaveLength(2)

  const p = r.positions[0]
  const lotQtySum = r.lots.reduce((s, l) => s + l.qty, 0)
  const lotCostSum = r.lots.reduce((s, l) => s + l.costBasis, 0)
  const lotValSum = r.lots.reduce((s, l) => s + (l.currentValue ?? 0), 0)
  expect(lotQtySum).toBeCloseTo(p.qty, 6)
  expect(lotCostSum).toBeCloseTo(p.costBasis, 6)
  expect(lotValSum).toBeCloseTo(p.currentValue!, 6)
  expect(p.lotCount).toBe(2)
  expect(p.acqDateMin).toBe('2024-01-01T00:00:00Z')
  expect(p.acqDateMax).toBe('2024-02-01T00:00:00Z')
})

test('monthsAvailable, walletOptions, tokenOptions populated', async () => {
  mockTxs = [
    tx({
      txHash: 'g',
      blockTime: ts('2024-01-15T00:00:00Z'),
      date: '2024-01-15T00:00:00Z',
      qty: 100,
      dir: 'In',
      price: 2,
      priceSource: 'genesis',
    }),
    tx({
      txHash: 't1',
      blockTime: ts('2024-03-15T00:00:00Z'),
      date: '2024-03-15T00:00:00Z',
      qty: 50,
      dir: 'In',
      price: 3,
      asset: 'SOL',
      walletAddr: 'wB',
      wallet: 'WalletB',
      priceSource: 'birdeye',
    }),
  ]
  mockCurrentPrices = { ORCA: 5, SOL: 100 }
  const r = await getTreasuryUnrealized({ entity: 'Foundation' })
  // Genesis month is excluded from monthsAvailable; only 2024-03 is user-meaningful.
  expect(r.monthsAvailable).toEqual(['2024-03'])
  expect(r.tokenOptions).toEqual(['ORCA', 'SOL'])
  expect(r.walletOptions.map((w) => w.walletAddr).sort()).toEqual(['wA', 'wB'])
})
