import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyPnlAccount, inventoryPnlTree } from './pnl-inventory.ts'
import { parsePnlReport } from '../qb/pnl.ts'
import type { PnlTree, PnlSection, PnlAccount } from '@/lib/qb/pnl'

// Union of account numbers actually observed in the four entity views,
// January–August 2026. This catches any missing explicit classification.
const observedCodes = `40001 40102 40110 40905 60110 60120 60130 60150 60160 60210 60220
60310 60320 60330 60340 60350 60410 60520 60610 60650 61010 61020
61110 61120 61130 62010 62020 62030 62040 62050 62060 62080 62090
63030 63040 63050 64010 64020 64030 64050 64060 64070 64110 64120
64130 64140 64150 64160 64170 65030 65040 65099 66010 66020 66030
66040 67010 67020 67030 68140 69020 69030 69040 69050 69099 70001
70002 70003 70004 70005 70009 70015 70110 70140 70150 70510 71001
71002 71003 71010 71020 71099 72000 73001 74000 75001 75002`.split(/\s+/)

test('every numbered P&L account observed January–August has an explicit subgroup', () => {
  assert.equal(observedCodes.length, 87)
  assert.deepEqual(observedCodes.filter((glCode) => classifyPnlAccount({ kind: 'account', glCode, label: glCode === '69099' ? 'Reconciliation Discrepancies' : glCode, amount: 1 }) === 'unclassified'), [])
})

test('preserves signed amounts, QB sections and code-less accounts in reconciliation', () => {
  const account = (glCode: string | null, label: string, amount: number): PnlAccount => ({ kind: 'account', glCode, label, amount })
  const section = (title: string, kind: PnlSection['sectionKind'], total: number, children: PnlSection['children']): PnlSection => ({ kind: 'section', title, sectionKind: kind, total, children })
  const tree: PnlTree = {
    sections: [
      section('Income', 'income', 108.25, [account('40110', 'Product', 100), account(null, 'Services', 8.25)]),
      section('Expenses', 'expense', 69, [
        section('Personnel', 'expense', 70, [account('60310', 'Contractors', 70)]),
        account('61020', 'Tools credit', -1),
      ]),
      section('Other Income(Loss)', 'other-income', -15, [account('70510', 'Realized loss', -15)]),
      section('Other Expenses', 'other-expense', 3, [account('69099', 'Reconciliation Discrepancies', 3)]),
    ],
    totals: { revenue: 108.25, expense: 69, otherIncome: -15, otherExpense: 3, netIncome: 21.25 },
  }
  const result = inventoryPnlTree(tree)
  assert.deepEqual(result.sectionResiduals, [])
  assert.equal(result.netIncomeResidual, 0)
  assert.deepEqual(result.unclassified.map((x) => [x.label, x.amount]), [['Services', 8.25]])
  assert.equal(result.groups.find((x) => x.kind === 'expense' && x.group === 'software')?.amount, -1)
  assert.equal(result.groups.find((x) => x.kind === 'other-income' && x.group === 'asset-gains')?.amount, -15)
  assert.equal(classifyPnlAccount(account('69099', 'Uncategorized Expense', 5)), 'other-operating')
  assert.equal(classifyPnlAccount(account('69099', 'Unknown new use', 5)), 'unclassified')
})

test('a QB report without its trailing net row still uses signed credits and losses', () => {
  const section = (name: string, value: number) => ({
    type: 'Section', Header: { ColData: [{ value: name }] },
    Summary: { ColData: [{}, { value: String(value) }] }, Rows: { Row: [] },
  })
  const tree = parsePnlReport({ Rows: { Row: [
    section('Income', 100), section('Expenses', 30),
    section('Other Income', -20), section('Other Expenses', -5),
  ] } })
  assert.equal(tree.totals.netIncome, 55)
})
