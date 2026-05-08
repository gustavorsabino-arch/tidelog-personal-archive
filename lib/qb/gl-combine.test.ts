import test from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateClasses,
  combineGlResults,
  GlNotCachedError,
  tagAndSortRows,
} from './gl-combine.ts'
import type { ParsedQboGeneralLedgerRow } from '@/lib/budget/qb-general-ledger'

function row(partial: Partial<ParsedQboGeneralLedgerRow>): ParsedQboGeneralLedgerRow {
  return {
    columnCount: 0,
    date: '2026-01-01',
    txnId: null,
    transactionType: null,
    documentNumber: null,
    name: null,
    className: null,
    memo: null,
    splitName: null,
    amountUsd: null,
    runningBalanceUsd: null,
    ...partial,
  }
}

test('aggregateClasses dedupes and sorts non-null classNames', () => {
  const rows = [
    row({ className: 'Engineering' }),
    row({ className: 'Marketing' }),
    row({ className: 'Engineering' }),
    row({ className: null }),
    row({ className: 'Finance' }),
  ]
  assert.deepEqual(aggregateClasses(rows), ['Engineering', 'Finance', 'Marketing'])
})

test('tagAndSortRows attaches entity and sorts by date asc', () => {
  const rows = [
    row({ date: '2026-03-15', amountUsd: 100 }),
    row({ date: '2026-01-02', amountUsd: 50 }),
    row({ date: '2026-02-01', amountUsd: 75 }),
  ]
  const tagged = tagAndSortRows([{ entity: 'Opco', rows }])
  assert.deepEqual(tagged.map((r) => r.date), ['2026-01-02', '2026-02-01', '2026-03-15'])
  assert.deepEqual(tagged.map((r) => r.entity), ['Opco', 'Opco', 'Opco'])
})

test('tagAndSortRows interleaves rows from multiple entities by date', () => {
  const opco = [row({ date: '2026-01-15' }), row({ date: '2026-03-01' })]
  const found = [row({ date: '2026-02-01' })]
  const tagged = tagAndSortRows([
    { entity: 'Opco', rows: opco },
    { entity: 'Foundation', rows: found },
  ])
  assert.deepEqual(tagged.map((r) => r.entity), ['Opco', 'Foundation', 'Opco'])
})

test('combineGlResults assembles the final result and sums amounts', () => {
  const result = combineGlResults(
    'Opco',
    '40110',
    '2026-01-01',
    '2026-01-31',
    '2026-01-31T00:00:00.000Z',
    [{ entity: 'Opco', rows: [
      row({ date: '2026-01-10', amountUsd: 100, className: 'Engineering' }),
      row({ date: '2026-01-20', amountUsd: -25, className: null }),
    ] }],
    [],
  )
  assert.equal(result.entity, 'Opco')
  assert.equal(result.totalAmount, 75)
  assert.deepEqual(result.classes, ['Engineering'])
  assert.deepEqual(result.partialEntities, [])
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].entity, 'Opco')
})

test('combineGlResults reports partialEntities for All-mode partial misses', () => {
  const result = combineGlResults(
    'All',
    '40110',
    '2026-01-01',
    '2026-01-31',
    '2026-01-31T00:00:00.000Z',
    [
      { entity: 'Opco', rows: [row({ amountUsd: 100 })] },
      { entity: 'Foundation', rows: [row({ amountUsd: 50 })] },
    ],
    ['Juku', 'Zagreus'],
  )
  assert.equal(result.entity, 'All')
  assert.equal(result.totalAmount, 150)
  assert.deepEqual(result.partialEntities, ['Juku', 'Zagreus'])
})

test('combineGlResults throws GlNotCachedError when ok is empty', () => {
  assert.throws(
    () => combineGlResults(
      'All',
      '40110',
      '2026-01-01',
      '2026-01-31',
      '2026-01-31T00:00:00.000Z',
      [],
      ['Opco', 'Foundation', 'Juku', 'Zagreus'],
    ),
    GlNotCachedError,
  )
})
