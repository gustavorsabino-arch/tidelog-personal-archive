import test from 'node:test'
import assert from 'node:assert/strict'

import { composeBudgetOverviewMappedLines, composeCoreProductRevenueByMonth } from './qb-actuals.ts'
import type { QboProfitAndLossReport } from './actuals.ts'
import type { BudgetQbMappingRow } from './types.ts'

function makeReport(accountTotals: Record<string, number>): QboProfitAndLossReport {
  return {
    Rows: {
      Row: [
        {
          type: 'Section',
          Rows: {
            Row: Object.entries(accountTotals).map(([account, value]) => ({
              type: 'Data',
              ColData: [{ value: `${account} Account` }, { value: String(value) }],
            })),
          },
        },
      ],
    },
  }
}

test('returns 12 months even when only some are cached', () => {
  const breakdown = composeCoreProductRevenueByMonth(
    2026,
    [
      { periodStart: '2026-01-01', data: makeReport({ '40110': 100000 }) },
      { periodStart: '2026-03-01', data: makeReport({ '40110': 250000 }) },
    ],
    '2026-04-15',
    '2026-04-15T00:00:00.000Z',
  )

  assert.equal(breakdown.months.length, 12)
  assert.equal(breakdown.months[0].month, '01')
  assert.equal(breakdown.months[0].actualUsd, 100000)
  assert.equal(breakdown.months[1].actualUsd, 0) // Feb missing
  assert.equal(breakdown.months[2].actualUsd, 250000)
  assert.equal(breakdown.months[11].month, '12')
  assert.equal(breakdown.months[11].actualUsd, 0)
})

test('only sums account 40110, ignores other accounts', () => {
  const breakdown = composeCoreProductRevenueByMonth(
    2026,
    [
      { periodStart: '2026-01-01', data: makeReport({ '40110': 100, '60110': 9999, '40200': 12345 }) },
    ],
    '2026-12-31',
    '2026-12-31T00:00:00.000Z',
  )

  assert.equal(breakdown.months[0].actualUsd, 100)
  assert.equal(breakdown.annualTotalUsd, 100)
})

test('takes absolute value (QB revenue arrives as negatives)', () => {
  const breakdown = composeCoreProductRevenueByMonth(
    2026,
    [
      { periodStart: '2026-02-01', data: makeReport({ '40110': -50000 }) },
    ],
    '2026-12-31',
    '2026-12-31T00:00:00.000Z',
  )

  assert.equal(breakdown.months[1].actualUsd, 50000)
})

test('YTD stops at today, annual covers all 12 months', () => {
  const rows = [
    { periodStart: '2026-01-01', data: makeReport({ '40110': 100 }) },
    { periodStart: '2026-02-01', data: makeReport({ '40110': 200 }) },
    { periodStart: '2026-03-01', data: makeReport({ '40110': 300 }) },
    { periodStart: '2026-12-01', data: makeReport({ '40110': 1000 }) }, // future
  ]

  const breakdown = composeCoreProductRevenueByMonth(2026, rows, '2026-03-15', '2026-03-15T00:00:00.000Z')

  // YTD includes Jan, Feb, Mar (Mar period starts 2026-03-01, before 2026-03-15).
  // Excludes Dec (future).
  assert.equal(breakdown.ytdTotalUsd, 600)
  assert.equal(breakdown.annualTotalUsd, 1600)
})

test('prior year: YTD equals annual', () => {
  const breakdown = composeCoreProductRevenueByMonth(
    2025,
    [
      { periodStart: '2025-06-01', data: makeReport({ '40110': 800 }) },
      { periodStart: '2025-09-01', data: makeReport({ '40110': 200 }) },
    ],
    '2026-04-30',
    '2026-04-30T00:00:00.000Z',
  )

  assert.equal(breakdown.ytdTotalUsd, 1000)
  assert.equal(breakdown.annualTotalUsd, 1000)
})

test('returns metadata on the breakdown', () => {
  const breakdown = composeCoreProductRevenueByMonth(2026, [], '2026-04-30', '2026-04-30T12:00:00.000Z')

  assert.equal(breakdown.year, 2026)
  assert.equal(breakdown.accountNumber, '40110')
  assert.equal(breakdown.entity, 'Opco')
  assert.equal(breakdown.fetchedAt, '2026-04-30T12:00:00.000Z')
})

const PROFESSIONAL_SERVICES_LINE: BudgetQbMappingRow = {
  cat: 'Operating Expenses',
  line: 'Professional Services',
  key: 'professionalServices',
  accounts: [62040],
}

test('composeBudgetOverviewMappedLines subtracts Council per account before mapping', () => {
  const result = composeBudgetOverviewMappedLines(
    [{
      reports: [makeReport({ '62040': 5000 })],
      councilSubtraction: { '62040': 1500 },
    }],
    [PROFESSIONAL_SERVICES_LINE],
  )

  assert.equal(result.professionalServices, 3500)
})

test('composeBudgetOverviewMappedLines sums per-account totals across multi-month and multi-entity reports', () => {
  const result = composeBudgetOverviewMappedLines(
    [
      {
        reports: [
          makeReport({ '62040': 1000 }),
          makeReport({ '62040': 2000 }),
        ],
        councilSubtraction: { '62040': 500 },
      },
      {
        reports: [makeReport({ '62040': 4000 })],
        councilSubtraction: {},
      },
    ],
    [PROFESSIONAL_SERVICES_LINE],
  )

  assert.equal(result.professionalServices, 6500)
})
