import test from 'node:test'
import assert from 'node:assert/strict'

import { buildGlAccountList } from './gl-account-list.ts'

test('buildGlAccountList includes all P&L-typed catalog accounts', () => {
  const list = buildGlAccountList([], [
    { accountNumber: '40110', accountId: 'qb-1', accountType: 'Income' },
    { accountNumber: '60110', accountId: 'qb-2', accountType: 'Expense' },
    { accountNumber: '99000', accountId: 'qb-3', accountType: 'Other Income' },
    { accountNumber: '99100', accountId: 'qb-4', accountType: 'Other Expense' },
    { accountNumber: '50000', accountId: 'qb-5', accountType: 'Cost of Goods Sold' },
  ])
  assert.deepEqual(list.map((x) => x.accountNumber), ['40110', '50000', '60110', '99000', '99100'])
})

test('buildGlAccountList excludes non-P&L account types', () => {
  const list = buildGlAccountList([], [
    { accountNumber: '40110', accountId: 'qb-1', accountType: 'Income' },
    { accountNumber: '11000', accountId: 'qb-2', accountType: 'Bank' },
    { accountNumber: '20000', accountId: 'qb-3', accountType: 'Accounts Payable' },
    { accountNumber: '30000', accountId: 'qb-4', accountType: 'Equity' },
  ])
  assert.deepEqual(list.map((x) => x.accountNumber), ['40110'])
})

test('buildGlAccountList unions budget-mapped accounts with catalog and dedupes', () => {
  // 40110 is budget-mapped AND P&L-typed; 70000 is budget-mapped only (e.g. an
  // off-P&L account they care about for budget analysis).
  const list = buildGlAccountList(['40110', '70000'], [
    { accountNumber: '40110', accountId: 'qb-1', accountType: 'Income' },
    { accountNumber: '70000', accountId: 'qb-7', accountType: 'Bank' },
  ])
  assert.deepEqual(list.map((x) => x.accountNumber), ['40110', '70000'])
})

test('buildGlAccountList drops catalog rows with null accountNumber', () => {
  const list = buildGlAccountList([], [
    { accountNumber: null, accountId: 'qb-x', accountType: 'Income' },
    { accountNumber: '40110', accountId: 'qb-1', accountType: 'Income' },
  ])
  assert.deepEqual(list.map((x) => x.accountNumber), ['40110'])
})

test('buildGlAccountList drops budget-mapped accounts not in catalog', () => {
  const list = buildGlAccountList(['99999'], [])
  assert.deepEqual(list, [])
})
