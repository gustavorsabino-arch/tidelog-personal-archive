import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPnlAccount } from './pnl-inventory.ts'

const rows = readFileSync('docs/report-pnl-accounts-2026-jan-aug.tsv', 'utf8').trim().split('\n').slice(1).map((line) => {
  const [entity, section, code, label, ...amounts] = line.split('\t')
  assert.equal(amounts.length, 8)
  return { entity, section, code, label, amounts: amounts.map(Number) }
})

// Signed QB totals, in cents: revenue includes Income + Other Income;
// expenses includes Expenses + Other Expenses. Juku has no cache to compare.
const qb = {
  Foundation: [
    [0, 1521413], [0, 2508909], [88506291, 107694200], [23968564, 5931749],
    [3837600, 1393643], [4984600, 5761180], [3333600, 14664030], [5272038, 6478462],
  ],
  Opco: [
    [40061891, 74287591], [56292434, 68302735], [-31969258, 48232703], [44725161, 54081036],
    [124468666, 51246704], [29813713, 109784301], [19290885, 54896099], [32810696, 65279621],
  ],
  Zagreus: [
    [47190063, 81046358], [25172891, 45857463], [43138967, 46484384], [64343970, 63906259],
    [53312537, 50635647], [75581819, 65427300], [26843874, 30979521], [35210873, 29701625],
  ],
} as const

test('all 24 captured monthly P&Ls reconcile account for account to QB', () => {
  assert.equal(rows.length, 129)
  assert.equal(new Set(rows.map((x) => x.code).filter(Boolean)).size, 87)
  for (const [entity, months] of Object.entries(qb)) {
    for (let index = 0; index < 8; index++) {
      const entityRows = rows.filter((row) => row.entity === entity)
      const revenue = entityRows.filter((row) => /^(Income|Other Income)$/.test(row.section)).reduce((sum, row) => sum + row.amounts[index], 0)
      const expense = entityRows.filter((row) => /^(Expenses|Other Expenses)$/.test(row.section)).reduce((sum, row) => sum + row.amounts[index], 0)
      assert.deepEqual([revenue, expense], months[index], `${entity} month ${index + 1}`)
      assert.equal(revenue - expense, months[index][0] - months[index][1])
    }
  }
  assert.deepEqual(rows.filter((row) => !row.code).map((row) => [row.entity, row.label, row.amounts[2]]), [
    ['Opco', 'Services (no QB account number)', 856225],
  ])
})

test('all observed numbered accounts map to one subgroup, even credits and zero balances', () => {
  assert.deepEqual(rows.filter((row) => row.code && classifyPnlAccount({ kind: 'account', glCode: row.code, label: row.label, amount: 0 }) === 'unclassified'), [])
})
