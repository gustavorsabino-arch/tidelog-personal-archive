import assert from 'node:assert/strict'
import test from 'node:test'

import { loadBudgetActualLedgerTransactions } from './qb-ledger-transactions.ts'

const BROKEN_GL_REPORT = {
  Rows: {
    Row: [
      {
        type: 'Data',
        ColData: [
          { value: '2026-01-31' },
          { value: 'Journal Entry', id: 'je-200' },
          { value: 'Dec-25 Accrual JER' },
          { value: '' },
          { value: 'General' },
          { value: 'Jan-26 Ops Services' },
        ],
      },
    ],
  },
}

const PARTIAL_GL_REPORT = {
  Rows: {
    Row: [
      {
        type: 'Data',
        ColData: [
          { value: '2026-01-31' },
          { value: 'Bill', id: 'bill-1' },
          { value: 'INV-1' },
          { value: 'Vendor A' },
          { value: 'Ops' },
          { value: 'Jan-26 Community Services' },
          { value: '2083.33' },
          { value: '0' },
        ],
      },
      {
        type: 'Data',
        ColData: [
          { value: '2026-01-31' },
          { value: 'Bill', id: 'bill-2' },
          { value: 'INV-2' },
          { value: 'Vendor B' },
          { value: 'General' },
          { value: 'Jan-26 Ops Services' },
        ],
      },
    ],
  },
}

const SAME_TXN_PARTIAL_GL_REPORT = {
  Rows: {
    Row: [
      {
        type: 'Data',
        ColData: [
          { value: '2026-02-01' },
          { value: 'Journal Entry', id: 'je-300' },
          { value: 'Jan-26 Payroll Acc JR' },
          { value: '' },
          { value: 'General' },
          { value: '[Rippling] Salary for Rebecca Lara. Payroll run: Jan 19th - Feb 1st' },
          { value: '7857.14' },
          { value: '0' },
        ],
      },
      {
        type: 'Data',
        ColData: [
          { value: '2026-02-01' },
          { value: 'Journal Entry', id: 'je-300' },
          { value: 'Jan-26 Payroll Acc JR' },
          { value: '' },
          { value: 'General' },
          { value: '[Rippling] Salary reversal for Rebecca Lara' },
        ],
      },
    ],
  },
}

test('falls back to transaction payload lines when GL rows carry no usable amounts', async () => {
  const result = await loadBudgetActualLedgerTransactions({
    entity: 'Zagreus',
    accountNumber: '60310',
    accountName: 'Contractor Labor',
    accountId: '60310-id',
    report: BROKEN_GL_REPORT,
    fetchTransactionPayload: async () => ({
      JournalEntry: {
        TxnDate: '2026-01-31',
        DocNumber: 'Dec-25 Accrual JER',
        Line: [
          {
            Amount: '4166.67',
            Description: 'Jan-26 Ops Services',
            JournalEntryLineDetail: {
              AccountRef: { value: '60310-id', name: '60310 Contractor Labor' },
              ClassRef: { value: 'general-class', name: 'General' },
              Entity: {
                EntityRef: { value: 'vendor-1', name: 'Sabrina de Carvalho' },
              },
            },
          },
        ],
      },
    }),
  })

  assert.equal(result.source, 'transaction-payload')
  assert.equal(result.transactions.length, 1)
  assert.equal(result.transactions[0]?.amountUsd, 4166.67)
  assert.equal(result.transactions[0]?.normalizedDepartment, 'General')
  assert.equal(result.transactions[0]?.name, 'Sabrina de Carvalho')
})

test('merges direct GL rows with transaction payload backfill rows when QuickBooks only returns partial amounts', async () => {
  const payloadByTxnId: Record<string, any> = {
    'bill-2': {
      Bill: {
        TxnDate: '2026-01-31',
        DocNumber: 'INV-2',
        Line: [
          {
            Amount: '4166.67',
            Description: 'Jan-26 Ops Services',
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: '60310-id', name: '60310 Contractor Labor' },
              ClassRef: { value: 'general-class', name: 'General' },
              CustomerRef: { value: 'vendor-2', name: 'Sabrina de Carvalho' },
            },
          },
        ],
      },
    },
  }

  const result = await loadBudgetActualLedgerTransactions({
    entity: 'Zagreus',
    accountNumber: '60310',
    accountName: 'Contractor Labor',
    accountId: '60310-id',
    report: PARTIAL_GL_REPORT,
    fetchTransactionPayload: async (_entity, path) => {
      const txnId = path.match(/\/([^/?]+)\?minorversion=/)?.[1]
      return payloadByTxnId[txnId ?? ''] ?? { Bill: { Line: [] } }
    },
  })

  assert.equal(result.source, 'merged')
  assert.equal(result.transactions.length, 2)
  assert.equal(result.transactions[0]?.amountUsd, 2083.33)
  assert.equal(result.transactions[1]?.amountUsd, 4166.67)
  assert.deepEqual(
    result.transactions.map((transaction) => transaction.normalizedDepartment),
    ['Ops', 'General'],
  )
})

test('backfills missing sibling lines from the same transaction without duplicating direct GL rows', async () => {
  const result = await loadBudgetActualLedgerTransactions({
    entity: 'Zagreus',
    accountNumber: '60110',
    accountName: 'Salaries & Wages',
    accountId: '60110-id',
    report: SAME_TXN_PARTIAL_GL_REPORT,
    fetchTransactionPayload: async () => ({
      JournalEntry: {
        TxnDate: '2026-02-01',
        DocNumber: 'Jan-26 Payroll Acc JR',
        Line: [
          {
            Amount: '7857.14',
            Description: '[Rippling] Salary for Rebecca Lara. Payroll run: Jan 19th - Feb 1st',
            JournalEntryLineDetail: {
              PostingType: 'Debit',
              AccountRef: { value: '60110-id', name: '60110 Salaries & Wages' },
              ClassRef: { value: 'general-class', name: 'General' },
              Entity: {
                EntityRef: { value: 'employee-1', name: 'Rebecca Lara' },
              },
            },
          },
          {
            Amount: '7857.14',
            Description: '[Rippling] Salary reversal for Rebecca Lara',
            JournalEntryLineDetail: {
              PostingType: 'Credit',
              AccountRef: { value: '60110-id', name: '60110 Salaries & Wages' },
              ClassRef: { value: 'general-class', name: 'General' },
              Entity: {
                EntityRef: { value: 'employee-1', name: 'Rebecca Lara' },
              },
            },
          },
        ],
      },
    }),
  })

  assert.equal(result.source, 'merged')
  assert.equal(result.transactions.length, 2)
  assert.deepEqual(
    result.transactions.map((transaction) => transaction.amountUsd).sort((left, right) => left - right),
    [-7857.14, 7857.14],
  )
})
