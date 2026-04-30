import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBudgetActualScopeAllocation,
  getBudgetActualScopeContribution,
} from './actual-allocation.ts'
import type { BudgetActualDrillTransaction } from './types.ts'

function makeTransaction(
  id: string,
  amountUsd: number,
  normalizedDepartment: BudgetActualDrillTransaction['normalizedDepartment'],
): BudgetActualDrillTransaction {
  return {
    id,
    entity: 'Opco',
    realmId: 'realm-opco',
    txnId: id,
    accountNumber: '60130',
    accountName: 'Benefits',
    splitName: 'Benefits',
    date: '2026-04-01',
    transactionType: 'Journal Entry',
    documentNumber: id,
    name: `Txn ${id}`,
    className: normalizedDepartment,
    normalizedDepartment,
    memo: null,
    amountUsd,
  }
}

function makeTransactionWithRawClass(
  id: string,
  amountUsd: number,
  rawClassName: string | null,
  normalizedDepartment: BudgetActualDrillTransaction['normalizedDepartment'],
): BudgetActualDrillTransaction {
  return {
    ...makeTransaction(id, amountUsd, normalizedDepartment),
    className: rawClassName,
  }
}

test('allocates transactions by department and tracks unresolved report remainder', () => {
  const allocation = buildBudgetActualScopeAllocation([
    makeTransaction('t-1', 40, 'Engineering'),
    makeTransaction('t-2', 15, null),
    makeTransaction('t-3', 25, 'Finance'),
  ], 95)

  assert.equal(allocation.transactionTotalUsd, 80)
  assert.equal(allocation.unclassifiedTotalUsd, 15)
  assert.equal(allocation.unresolvedTotalUsd, 15)
  assert.equal(allocation.departmentTotals.Engineering, 40)
  assert.equal(allocation.departmentTotals['Finance'], 25)
})

test('returns the same contribution totals used by overview and department actuals', () => {
  const allocation = buildBudgetActualScopeAllocation([
    makeTransaction('t-1', 40, 'Engineering'),
    makeTransaction('t-2', 15, null),
    makeTransaction('t-3', 25, 'Finance'),
  ], 95)

  assert.deepEqual(getBudgetActualScopeContribution(allocation, null), {
    transactions: allocation.allTransactions,
    transactionTotalUsd: 80,
    unresolvedTotalUsd: 15,
    totalUsd: 95,
  })

  assert.deepEqual(getBudgetActualScopeContribution(allocation, 'Engineering'), {
    transactions: [allocation.allTransactions[0]],
    transactionTotalUsd: 40,
    unresolvedTotalUsd: 0,
    totalUsd: 40,
  })

  assert.deepEqual(getBudgetActualScopeContribution(allocation, 'Not specified'), {
    transactions: [allocation.allTransactions[1]],
    transactionTotalUsd: 15,
    unresolvedTotalUsd: 15,
    totalUsd: 30,
  })
})

test('drops Council transactions before bucketing or totals', () => {
  const allocation = buildBudgetActualScopeAllocation([
    makeTransactionWithRawClass('keep-1', 40, 'Engineering', 'Engineering'),
    makeTransactionWithRawClass('drop-1', 1500, 'Council', null),
    makeTransactionWithRawClass('drop-2', 200, 'Legal:Council', 'Legal'),
    makeTransactionWithRawClass('keep-2', 25, 'Finance', 'Finance'),
  ], /* accountTotalUsd already adjusted upstream */ 65)

  // Council txns are absent from allTransactions and from any total/bucket.
  assert.equal(allocation.allTransactions.length, 2)
  assert.deepEqual(allocation.allTransactions.map((t) => t.id), ['keep-1', 'keep-2'])
  assert.equal(allocation.transactionTotalUsd, 65)
  assert.equal(allocation.unclassifiedTotalUsd, 0)
  assert.equal(allocation.unresolvedTotalUsd, 0)
  assert.equal(allocation.departmentTotals.Engineering, 40)
  assert.equal(allocation.departmentTotals['Finance'], 25)
})
