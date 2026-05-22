import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyCouncilSubtraction,
  composeCouncilSubtractionByAccount,
  filterExcludedClassEntries,
} from './qb-class-exclusion.ts'
import type { BudgetQboTransactionPayloadRecord } from './qb-transaction-payload.ts'

function makeRecord(
  lines: ReadonlyArray<{
    accountId: string | null
    className: string | null
    amountUsd: number | null
  }>,
): BudgetQboTransactionPayloadRecord {
  return {
    txnId: 'tx-1',
    transactionType: 'Bill',
    resourceType: 'bill',
    sourceRowDate: '2026-03-17',
    sourceRowClassName: 'Council',
    txDate: '2026-03-17',
    documentNumber: null,
    memo: null,
    counterpartyName: null,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      accountName: null,
      className: line.className,
      normalizedDepartment: null,
      amountUsd: line.amountUsd,
      description: null,
      entityName: null,
    })),
    error: null,
  }
}

test('composeCouncilSubtractionByAccount sums Council lines by accountNumber via the catalog', () => {
  const records = [
    makeRecord([
      { accountId: '596', className: 'Council', amountUsd: 1500 },
    ]),
    makeRecord([
      { accountId: '610', className: 'Engineering', amountUsd: 9000 },
      { accountId: '596', className: 'Council:Foo', amountUsd: 200 },
      { accountId: '596', className: 'Legal', amountUsd: 800 },
    ]),
  ]
  const accountNumberById = new Map([
    ['596', '62040'],
    ['610', '62070'],
  ])

  const result = composeCouncilSubtractionByAccount(records, accountNumberById)

  assert.deepEqual(result, { '62040': 1700 })
})

test('composeCouncilSubtractionByAccount returns empty when no Council lines exist', () => {
  const records = [
    makeRecord([{ accountId: '596', className: 'Engineering', amountUsd: 9000 }]),
  ]
  const accountNumberById = new Map([['596', '62040']])

  assert.deepEqual(composeCouncilSubtractionByAccount(records, accountNumberById), {})
})

test('composeCouncilSubtractionByAccount skips lines with missing accountId, missing amount, or unmapped account', () => {
  const records = [
    makeRecord([
      { accountId: null, className: 'Council', amountUsd: 100 },
      { accountId: '596', className: 'Council', amountUsd: null },
      { accountId: 'unknown-id', className: 'Council', amountUsd: 50 },
    ]),
  ]
  const accountNumberById = new Map([['596', '62040']])

  assert.deepEqual(composeCouncilSubtractionByAccount(records, accountNumberById), {})
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
