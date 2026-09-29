import test from 'node:test'
import assert from 'node:assert/strict'

import { buildPresentationFinancials, getMonthComparison, getYtdTrend, getYtdSummary, type CachedPnlMonth } from './financials.ts'
import type { QboEntity } from '@/lib/qb/config'

function report(entity: QboEntity, month: number, revenue: number, expense: number): CachedPnlMonth {
  const section = (title: string, amount: number) => ({
    type: 'Section', Header: { ColData: [{ value: title }] }, Summary: { ColData: [{}, { value: String(amount) }] }, Rows: { Row: [] },
  })
  return {
    entity,
    periodStart: `2026-${String(month).padStart(2, '0')}-01`,
    data: { Rows: { Row: [section('Income', revenue), section('Expenses', expense)] } },
  }
}

test('MoM and YTD use the cached monthly P&L and expose partial entity coverage', () => {
  const data = buildPresentationFinancials(2026, [
    report('Opco', 1, 100, 20), report('Foundation', 1, 50, 10),
    report('Juku', 1, 25, 5), report('Zagreus', 1, 25, 5),
    report('Opco', 2, 150, 30), report('Foundation', 2, 70, 20),
    report('Juku', 2, 30, 10),
  ])
  const opco = getMonthComparison(data, 'Opco', 1, 2)
  assert.equal(opco.complete, true)
  assert.equal(opco.a?.totals.revenue, 100)
  assert.equal(opco.b?.totals.revenue, 150)
  assert.equal(opco.lines.find((line) => line.label === 'Income')?.b, 150)

  const group = getMonthComparison(data, 'All', 1, 2)
  assert.equal(group.complete, false)
  assert.deepEqual(group.b?.presentEntities, ['Opco', 'Foundation', 'Juku'])
  assert.equal(group.a?.totals.revenue, 200)
  assert.equal(group.b?.totals.revenue, 250)

  const trend = getYtdTrend(data, 'All', 3)
  assert.equal(trend.complete, false)
  assert.equal(trend.ytd.revenue, 450)
  assert.equal(trend.rows[2], null)
  const ytdOpco = getYtdSummary(data, 'Opco', 3)
  assert.equal(ytdOpco.complete, false)
  assert.deepEqual(ytdOpco.missingMonths, [3])
  assert.equal(ytdOpco.totals.netIncome, 200)
  const ytdGroup = getYtdSummary(data, 'All', 2)
  assert.equal(ytdGroup.complete, false)
  assert.deepEqual(ytdGroup.presentEntities, ['Opco', 'Foundation', 'Juku', 'Zagreus'])
})
