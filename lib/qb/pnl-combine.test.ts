import test from 'node:test'
import assert from 'node:assert/strict'

import {
  combineEntityResults,
  PnlNotCachedError,
  type EntityLoadResult,
} from './pnl-combine.ts'
import type { PnlTree } from './pnl.ts'
import type { QboEntity } from './config.ts'

const FETCHED_AT = '2026-05-06T00:00:00.000Z'

function makeTree(revenue: number, expense: number): PnlTree {
  return {
    sections: [
      {
        kind: 'section',
        title: 'Income',
        sectionKind: 'income',
        total: revenue,
        children: [
          { kind: 'account', label: '4000 Revenue', glCode: '4000', amount: revenue },
        ],
      },
    ],
    totals: { revenue, expense, otherIncome: 0, otherExpense: 0, netIncome: revenue - expense },
  }
}

function present(entity: QboEntity, tree: PnlTree, cachedMonths = 1): EntityLoadResult {
  return { entity, tree, cachedMonths }
}

function missing(entity: QboEntity): EntityLoadResult {
  return { entity, tree: null, cachedMonths: 0 }
}

test('combineEntityResults: All-mode merge sums trees and reports zero partials', () => {
  const results: EntityLoadResult[] = [
    present('Opco', makeTree(100, 10), 1),
    present('Foundation', makeTree(200, 20), 2),
    present('Juku', makeTree(300, 30), 3),
    present('Zagreus', makeTree(400, 40), 4),
  ]

  const out = combineEntityResults(results, 'All', '2026-01-01', '2026-01-31', FETCHED_AT)

  assert.equal(out.entity, 'All')
  assert.equal(out.periodStart, '2026-01-01')
  assert.equal(out.periodEnd, '2026-01-31')
  assert.equal(out.fetchedAt, FETCHED_AT)
  assert.equal(out.totals.revenue, 1000)
  assert.equal(out.totals.expense, 100)
  assert.deepEqual(out.partialEntities, [])
  assert.equal(out.cachedMonths, 10)
})

test('combineEntityResults: partial-failure merges present and lists missing', () => {
  const results: EntityLoadResult[] = [
    present('Opco', makeTree(100, 10), 1),
    missing('Foundation'),
    present('Juku', makeTree(300, 30), 2),
    missing('Zagreus'),
  ]

  const out = combineEntityResults(results, 'All', '2026-01-01', '2026-01-31', FETCHED_AT)

  assert.equal(out.totals.revenue, 400)
  assert.equal(out.totals.expense, 40)
  assert.deepEqual(out.partialEntities, ['Foundation', 'Zagreus'])
  assert.equal(out.cachedMonths, 3)
})

test('combineEntityResults: All-mode with every entity null throws PnlNotCachedError', () => {
  const results: EntityLoadResult[] = [
    missing('Opco'),
    missing('Foundation'),
    missing('Juku'),
    missing('Zagreus'),
  ]

  assert.throws(
    () => combineEntityResults(results, 'All', '2026-01-01', '2026-01-31', FETCHED_AT),
    (err: unknown) => err instanceof PnlNotCachedError,
  )
})

test('combineEntityResults: single-entity passthrough returns empty partialEntities', () => {
  const results: EntityLoadResult[] = [present('Opco', makeTree(500, 50), 7)]

  const out = combineEntityResults(results, 'Opco', '2026-01-01', '2026-01-31', FETCHED_AT)

  assert.equal(out.entity, 'Opco')
  assert.equal(out.totals.revenue, 500)
  assert.equal(out.totals.expense, 50)
  assert.equal(out.cachedMonths, 7)
  assert.deepEqual(out.partialEntities, [])
})

test('combineEntityResults: single-entity null throws PnlNotCachedError', () => {
  const results: EntityLoadResult[] = [missing('Opco')]

  assert.throws(
    () => combineEntityResults(results, 'Opco', '2026-01-01', '2026-01-31', FETCHED_AT),
    (err: unknown) => err instanceof PnlNotCachedError,
  )
})
