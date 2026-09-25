import test from 'node:test'
import assert from 'node:assert/strict'

import {
  coveredMonths,
  netAdjustmentByMonth,
  foldAdjustmentForColumn,
  annualNetAdjustment,
  type AdjustmentRecord,
} from './adjustments.ts'

function adj(partial: Partial<AdjustmentRecord>): AdjustmentRecord {
  return {
    department: 'Engineering',
    lineItem: 'epdTools',
    kind: 'one_time',
    amount: 10000,
    startPeriod: '10',
    durationMonths: 1,
    status: 'active',
    ...partial,
  }
}

test('coveredMonths: one_time covers only its start month', () => {
  assert.deepEqual(coveredMonths(adj({ kind: 'one_time', startPeriod: '10' })), ['10'])
})

test('coveredMonths: recurring covers start..start+duration-1', () => {
  assert.deepEqual(
    coveredMonths(adj({ kind: 'recurring', startPeriod: '10', durationMonths: 3 })),
    ['10', '11', '12'],
  )
})

test('coveredMonths: recurring clamps to December (no spill into next year)', () => {
  assert.deepEqual(
    coveredMonths(adj({ kind: 'recurring', startPeriod: '11', durationMonths: 4 })),
    ['11', '12'],
  )
})

test('netAdjustmentByMonth: sums active adjustments per covered month for the line item', () => {
  const net = netAdjustmentByMonth(
    [
      adj({ amount: 10000, startPeriod: '10' }),
      adj({ kind: 'recurring', amount: 500, startPeriod: '11', durationMonths: 2 }),
    ],
    { lineItem: 'epdTools' },
  )
  assert.equal(net['10'], 10000)
  assert.equal(net['11'], 500)
  assert.equal(net['12'], 500)
  assert.equal(net['09'] ?? 0, 0)
})

test('netAdjustmentByMonth: excludes reversed adjustments', () => {
  const net = netAdjustmentByMonth(
    [adj({ amount: 10000, startPeriod: '10', status: 'reversed' })],
    { lineItem: 'epdTools' },
  )
  assert.equal(net['10'] ?? 0, 0)
})

test('netAdjustmentByMonth: filters by line item; other line items ignored', () => {
  const net = netAdjustmentByMonth(
    [adj({ lineItem: 'travel', amount: 999, startPeriod: '10' })],
    { lineItem: 'epdTools' },
  )
  assert.equal(net['10'] ?? 0, 0)
})

test('netAdjustmentByMonth: aggregates across departments when no department filter (All view)', () => {
  const net = netAdjustmentByMonth(
    [
      adj({ department: 'Engineering', amount: 10000, startPeriod: '10' }),
      adj({ department: 'Marketing', amount: 5000, startPeriod: '10' }),
    ],
    { lineItem: 'epdTools' },
  )
  assert.equal(net['10'], 15000)
})

test('netAdjustmentByMonth: filters by department when provided', () => {
  const net = netAdjustmentByMonth(
    [
      adj({ department: 'Engineering', amount: 10000, startPeriod: '10' }),
      adj({ department: 'Marketing', amount: 5000, startPeriod: '10' }),
    ],
    { lineItem: 'epdTools', department: 'Engineering' },
  )
  assert.equal(net['10'], 10000)
})

test('foldAdjustmentForColumn: an Oct adjustment does NOT appear in September period/ytd', () => {
  const net = netAdjustmentByMonth([adj({ amount: 10000, startPeriod: '10' })], { lineItem: 'epdTools' })
  assert.equal(foldAdjustmentForColumn(net, 'period', '09'), 0)
  assert.equal(foldAdjustmentForColumn(net, 'ytd', '09'), 0)
  assert.equal(foldAdjustmentForColumn(net, 'annual', '09'), 10000)
})

test('foldAdjustmentForColumn: an Oct adjustment appears in Nov period(0)/ytd/annual', () => {
  const net = netAdjustmentByMonth([adj({ amount: 10000, startPeriod: '10' })], { lineItem: 'epdTools' })
  assert.equal(foldAdjustmentForColumn(net, 'period', '11'), 0) // Nov itself has no adjustment
  assert.equal(foldAdjustmentForColumn(net, 'period', '10'), 10000) // Oct month shows it
  assert.equal(foldAdjustmentForColumn(net, 'ytd', '11'), 10000) // YTD through Nov includes Oct
  assert.equal(foldAdjustmentForColumn(net, 'annual', '11'), 10000)
})

test('annualNetAdjustment: sums every month', () => {
  const net = netAdjustmentByMonth(
    [adj({ kind: 'recurring', amount: 1000, startPeriod: '10', durationMonths: 3 })],
    { lineItem: 'epdTools' },
  )
  assert.equal(annualNetAdjustment(net), 3000)
})
