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
