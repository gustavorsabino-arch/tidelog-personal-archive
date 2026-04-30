import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyCouncilSubtraction,
  filterExcludedClassEntries,
  sumCouncilByAccountFromGeneralLedger,
} from './qb-class-exclusion.ts'
import type { QboGeneralLedgerReport } from './actuals.ts'

function header(value: string) {
  return { Header: { ColData: [{ value }] } }
}

function dataRow(date: string, className: string, amountUsd: number) {
  return {
    type: 'Data',
    ColData: [
      { value: date },                    // 0 date
      { value: 'JE-1', id: 'tx-1' },      // 1 txn ref
      { value: '' },                      // 2 doc number
      { value: '' },                      // 3 name
      { value: className },               // 4 class
      { value: '' },                      // 5 memo
      { value: amountUsd.toFixed(2) },    // 6 amount
      { value: '0.00' },                  // 7 running balance
    ],
  }
}

test('sumCouncilByAccountFromGeneralLedger sums Council rows by leading-digit account number', () => {
  const report: QboGeneralLedgerReport = {
    Rows: {
      Row: [
        {
          ...header('62040 Professional Services'),
          Rows: {
            Row: [
              dataRow('2026-03-17', 'Council', 1500),
              dataRow('2026-03-18', 'Legal', 800),
              dataRow('2026-03-19', 'Council:Foo', 200),
            ],
          },
        },
        {
          ...header('60110 Salaries & Wages'),
          Rows: {
            Row: [
              dataRow('2026-03-01', 'Engineering', 50000),
              dataRow('2026-03-01', 'Legal:Council', 7000),
            ],
          },
        },
        {
          ...header('70000 Other'),
          Rows: { Row: [dataRow('2026-03-01', 'Ops', 100)] },
        },
      ],
    },
  } as unknown as QboGeneralLedgerReport

  const result = sumCouncilByAccountFromGeneralLedger(report)

  assert.deepEqual(result, {
    '62040': 1700,
    '60110': 7000,
  })
})

test('sumCouncilByAccountFromGeneralLedger returns empty map when no Council rows exist', () => {
  const report: QboGeneralLedgerReport = {
    Rows: {
      Row: [
        {
          ...header('60110 Salaries & Wages'),
          Rows: { Row: [dataRow('2026-03-01', 'Engineering', 100)] },
        },
      ],
    },
  } as unknown as QboGeneralLedgerReport

  assert.deepEqual(sumCouncilByAccountFromGeneralLedger(report), {})
})

test('applyCouncilSubtraction subtracts per-account amounts; preserves untouched accounts', () => {
  const totals = { '62040': 5000, '60110': 100000, '70000': 250 }
  const subtraction = { '62040': 1700, '60110': 7000 }

  const result = applyCouncilSubtraction(totals, subtraction)

  assert.deepEqual(result, { '62040': 3300, '60110': 93000, '70000': 250 })
})

test('applyCouncilSubtraction clamps negative results to zero', () => {
  // Defensive: a stale or out-of-range cache could surface a Council
  // subtotal larger than the matching P&L total. Clamp rather than
  // surface a negative line on the budget overview.
  const result = applyCouncilSubtraction({ '62040': 100 }, { '62040': 250 })
  assert.deepEqual(result, { '62040': 0 })
})

test('applyCouncilSubtraction is a no-op when subtraction map is empty', () => {
  const totals = { '60110': 100 }
  assert.deepEqual(applyCouncilSubtraction(totals, {}), { '60110': 100 })
})

test('applyCouncilSubtraction does not mutate the input totals', () => {
  const totals = { '62040': 5000 }
  applyCouncilSubtraction(totals, { '62040': 1000 })
  assert.deepEqual(totals, { '62040': 5000 })
})

test('filterExcludedClassEntries drops Council classes at any depth', () => {
  const classified = {
    Engineering: 50000,
    Council: 1500,
    'Legal:Council': 7000,
    Legal: 800,
    'Council:Foo': 200,
  }
  const result = filterExcludedClassEntries(classified)

  assert.deepEqual(result, { Engineering: 50000, Legal: 800 })
})

test('filterExcludedClassEntries does not mutate the input', () => {
  const classified = { Council: 100, Engineering: 200 }
  filterExcludedClassEntries(classified)
  assert.deepEqual(classified, { Council: 100, Engineering: 200 })
})
