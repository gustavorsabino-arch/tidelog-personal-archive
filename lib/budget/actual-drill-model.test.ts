import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBudgetActualDrillTransactionsFromTransactionPayloads,
  filterBudgetActualDrillTransactions,
  parseBudgetActualDrillTransactions,
  pickBudgetActualDrillNameFromDescription,
  pickBudgetActualDrillNameFromJournalEntry,
  summarizeBudgetActualDrillAccounts,
} from './actual-drill-model.ts'

const SAMPLE_REPORT = {
  Rows: {
    Row: [
      {
        type: 'Section',
        Rows: {
          Row: [
            {
              type: 'Data',
              ColData: [
                { value: '2026-02-01' },
                { value: 'Bill', id: '9001' },
                { value: '1001' },
                { value: 'Vendor A' },
                { value: 'Engineering' },
                { value: 'Infra memo' },
                { value: '250' },
                { value: '250' },
              ],
            },
            {
              type: 'Data',
              ColData: [
                { value: '2026-02-02' },
                { value: 'Bill', id: '9002' },
                { value: '1002' },
                { value: 'Vendor B' },
                { value: '' },
                { value: 'Unclassified memo' },
                { value: '50' },
                { value: '300' },
              ],
            },
          ],
        },
      },
    ],
  },
}

const NINE_COLUMN_REPORT = {
  Rows: {
    Row: [
      {
        type: 'Data',
        ColData: [
          { value: '02/03/2026' },
          { value: 'Journal Entry', id: 'je-1' },
          { value: '2001' },
          { value: '' },
          { value: '' },
          { value: 'Manual JE memo' },
          { value: 'Expenses:Professional Services' },
          { value: '125' },
          { value: '125' },
        ],
      },
    ],
  },
}

const SHORT_ROW_REPORT = {
  Rows: {
    Row: [
      {
        type: 'Data',
        ColData: [
          { value: '2026-01-31' },
          { value: 'Journal Entry', id: 'je-2' },
          { value: 'Dec-25 Accrual JER' },
          { value: '' },
          { value: 'General' },
          { value: '4166.67' },
        ],
      },
    ],
  },
}

test('parses GL report rows into actual drill transactions with normalized departments', () => {
  const transactions = parseBudgetActualDrillTransactions(SAMPLE_REPORT, {
    entity: 'Opco',
    realmId: 'realm-1',
    accountNumber: '61110',
    accountName: 'AWS',
  })

  assert.equal(transactions.length, 2)
  assert.equal(transactions[0]?.normalizedDepartment, 'Engineering')
  assert.equal(transactions[1]?.normalizedDepartment, null)
  assert.equal(transactions[0]?.amountUsd, 250)
  assert.equal(transactions[0]?.txnId, '9001')
  assert.equal(transactions[0]?.realmId, 'realm-1')
  assert.equal(transactions[0]?.splitName, null)
})

test('parses nine-column journal-entry layouts into v1-style account full name fields', () => {
  const transactions = parseBudgetActualDrillTransactions(NINE_COLUMN_REPORT, {
    entity: 'Opco',
    realmId: 'realm-1',
    accountNumber: '70100',
    accountName: 'Professional Services',
  })

  assert.equal(transactions.length, 1)
  assert.equal(transactions[0]?.date, '2026-02-03')
  assert.equal(transactions[0]?.transactionType, 'Journal Entry')
  assert.equal(transactions[0]?.splitName, 'Expenses:Professional Services')
  assert.equal(transactions[0]?.name, null)
})

test('parses short GL rows when the amount is the last available column', () => {
  const transactions = parseBudgetActualDrillTransactions(SHORT_ROW_REPORT, {
    entity: 'Zagreus',
    realmId: 'realm-1',
    accountNumber: '60310',
    accountName: 'Contractor Labor',
  })

  assert.equal(transactions.length, 1)
  assert.equal(transactions[0]?.txnId, 'je-2')
  assert.equal(transactions[0]?.normalizedDepartment, 'General')
  assert.equal(transactions[0]?.amountUsd, 4166.67)
  assert.equal(transactions[0]?.memo, null)
})

test('skips zero-amount GL rows in drill output', () => {
  const report = {
    Rows: {
      Row: [
        {
          type: 'Data',
          ColData: [
            { value: '2026-02-28' },
            { value: 'Journal Entry', id: 'je-zero' },
            { value: 'Feb-26 Payroll Acc' },
            { value: 'Jonathan Avery' },
            { value: 'General' },
            { value: 'Feb-26 Employee Wellness Bonus Accrual' },
            { value: '0.00' },
            { value: '0.00' },
          ],
        },
        {
          type: 'Data',
          ColData: [
            { value: '2026-02-28' },
            { value: 'Journal Entry', id: 'je-positive' },
            { value: 'Feb-26 Payroll Acc' },
            { value: 'Zach Choi' },
            { value: 'General' },
            { value: 'Feb-26 Employee Wellness Bonus Accrual' },
            { value: '142.85' },
            { value: '142.85' },
          ],
        },
      ],
    },
  }

  const transactions = parseBudgetActualDrillTransactions(report, {
    entity: 'Zagreus',
    realmId: 'realm-z',
    accountNumber: '60520',
    accountName: 'Employee Wellness Bonus',
  })

  assert.equal(transactions.length, 1)
  assert.equal(transactions[0]?.txnId, 'je-positive')
  assert.equal(transactions[0]?.amountUsd, 142.85)
})

test('builds actual drill transactions from matched transaction payload lines when GL amounts are missing', () => {
  const transactions = buildBudgetActualDrillTransactionsFromTransactionPayloads(
    [
      {
        txnId: 'je-200',
        transactionType: 'Journal Entry',
        resourceType: 'journalentry',
        sourceRowDate: '2026-01-31',
        sourceRowClassName: 'General',
        txDate: '2026-01-31',
        documentNumber: 'Dec-25 Accrual JER',
        memo: 'fallback memo',
        counterpartyName: 'TMOC Labs LLC',
        error: null,
        lines: [
          {
            accountId: '60310-id',
            accountName: '60310 Contractor Labor',
            className: 'General',
            normalizedDepartment: 'General',
            amountUsd: 4166.67,
            description: 'Jan-26 Ops Services',
            entityName: 'Sabrina de Carvalho',
          },
        ],
      },
    ],
    '60310-id',
    {
      entity: 'Zagreus',
      realmId: 'realm-z',
      accountNumber: '60310',
      accountName: 'Contractor Labor',
    },
  )

  assert.equal(transactions.length, 1)
  assert.equal(transactions[0]?.date, '2026-01-31')
  assert.equal(transactions[0]?.documentNumber, 'Dec-25 Accrual JER')
  assert.equal(transactions[0]?.name, 'Sabrina de Carvalho')
  assert.equal(transactions[0]?.memo, 'Jan-26 Ops Services')
  assert.equal(transactions[0]?.splitName, '60310 Contractor Labor')
  assert.equal(transactions[0]?.amountUsd, 4166.67)
})

test('preserves journal entry credit signs for payload-backed drill rows', () => {
  const transactions = buildBudgetActualDrillTransactionsFromTransactionPayloads(
    [
      {
        txnId: 'je-203',
        transactionType: 'Journal Entry',
        resourceType: 'journalentry',
        sourceRowDate: '2026-02-01',
        sourceRowClassName: 'General',
        txDate: '2026-02-01',
        documentNumber: 'Jan-26 Payroll Acc JR',
        memo: '[Rippling] Salary reversal for Rebecca Lara',
        counterpartyName: 'Rippling',
        error: null,
        lines: [
          {
            accountId: '60110-id',
            accountName: '60110 Salaries & Wages',
            className: 'General',
            normalizedDepartment: 'General',
            amountUsd: -7857.14,
            description: '[Rippling] Salary reversal for Rebecca Lara',
            entityName: 'Rebecca Lara',
          },
        ],
      },
    ],
    '60110-id',
    {
      entity: 'Zagreus',
      realmId: 'realm-z',
      accountNumber: '60110',
      accountName: 'Salaries & Wages',
    },
  )

  assert.equal(transactions.length, 1)
  assert.equal(transactions[0]?.amountUsd, -7857.14)
  assert.equal(transactions[0]?.name, 'Rebecca Lara')
})

test('skips zero-amount payload lines while preserving non-zero signed rows', () => {
  const transactions = buildBudgetActualDrillTransactionsFromTransactionPayloads(
    [
      {
        txnId: 'je-204',
        transactionType: 'Journal Entry',
        resourceType: 'journalentry',
        sourceRowDate: '2026-02-28',
        sourceRowClassName: 'General',
        txDate: '2026-02-28',
        documentNumber: 'Feb-26 Payroll Acc',
        memo: 'Feb-26 Employee Wellness Bonus Accrual',
        counterpartyName: 'Rippling',
        error: null,
        lines: [
          {
            accountId: '60530-id',
            accountName: '60530 Employee Wellness Bonus',
            className: 'General',
            normalizedDepartment: 'General',
            amountUsd: 142.85,
            description: 'Feb-26 Employee Wellness Bonus Accrual',
            entityName: 'Casey-Leigh Charlesworth',
          },
          {
            accountId: '60530-id',
            accountName: '60530 Employee Wellness Bonus',
            className: 'General',
            normalizedDepartment: 'General',
            amountUsd: 0,
            description: 'Feb-26 Employee Wellness Bonus Accrual',
            entityName: 'Jonathan Avery',
          },
          {
            accountId: '60530-id',
            accountName: '60530 Employee Wellness Bonus',
            className: 'General',
            normalizedDepartment: 'General',
            amountUsd: -142.85,
            description: 'Feb-26 Employee Wellness Bonus Reversal',
            entityName: 'Rebecca Lara',
          },
        ],
      },
    ],
    '60530-id',
    {
      entity: 'Zagreus',
      realmId: 'realm-z',
      accountNumber: '60530',
      accountName: 'Employee Wellness Bonus',
    },
  )

  assert.equal(transactions.length, 2)
  assert.deepEqual(
    transactions.map((transaction) => [transaction.name, transaction.amountUsd]),
    [
      ['Casey-Leigh Charlesworth', 142.85],
      ['Rebecca Lara', -142.85],
    ],
  )
})

test('prefers participant names parsed from Rippling descriptions for payload-backed rows', () => {
  const transactions = buildBudgetActualDrillTransactionsFromTransactionPayloads(
    [
      {
        txnId: 'je-201',
        transactionType: 'Journal Entry',
        resourceType: 'journalentry',
        sourceRowDate: '2026-03-29',
        sourceRowClassName: 'Engineering',
        txDate: '2026-03-29',
        documentNumber: 'Mar-26 Payroll',
        memo: '[Rippling] ICHRA Reimbursements for Jonathan Wardell Avery. Payroll run: Mar 16th - Mar 29th',
        counterpartyName: 'Jacob Shiohira',
        error: null,
        lines: [
          {
            accountId: '60520-id',
            accountName: 'Employee Benefits:Fringe Benefits',
            className: 'Engineering',
            normalizedDepartment: 'Engineering',
            amountUsd: 1200,
            description: '[Rippling] ICHRA Reimbursements for Jonathan Wardell Avery. Payroll run: Mar 16th - Mar 29th',
            entityName: 'Jacob Shiohira',
          },
        ],
      },
    ],
    '60520-id',
    {
      entity: 'Zagreus',
      realmId: 'realm-z',
      accountNumber: '60520',
      accountName: 'Fringe Benefits',
    },
  )

  assert.equal(transactions.length, 1)
  assert.equal(transactions[0]?.name, 'Jonathan Wardell Avery')
  assert.equal(transactions[0]?.memo, '[Rippling] ICHRA Reimbursements for Jonathan Wardell Avery. Payroll run: Mar 16th - Mar 29th')
})

test('parses distinct participant names for multiple Rippling lines from the same payload record', () => {
  const transactions = buildBudgetActualDrillTransactionsFromTransactionPayloads(
    [
      {
        txnId: 'je-202',
        transactionType: 'Journal Entry',
        resourceType: 'journalentry',
        sourceRowDate: '2026-03-29',
        sourceRowClassName: 'Engineering',
        txDate: '2026-03-29',
        documentNumber: 'Mar-26 Payroll',
        memo: 'Mar-26 Payroll',
        counterpartyName: 'Jacob Shiohira',
        error: null,
        lines: [
          {
            accountId: '60520-id',
            accountName: 'Employee Benefits:Fringe Benefits',
            className: 'Engineering',
            normalizedDepartment: 'Engineering',
            amountUsd: 1200,
            description: '[Rippling] ICHRA Reimbursements for Jonathan Wardell Avery. Payroll run: Mar 16th - Mar 29th',
            entityName: 'Jacob Shiohira',
          },
          {
            accountId: '60520-id',
            accountName: 'Employee Benefits:Fringe Benefits',
            className: 'Engineering',
            normalizedDepartment: 'Engineering',
            amountUsd: 800,
            description: '[Rippling] ICHRA Reimbursements for Jun Hee Kim. Payroll run: Mar 16th - Mar 29th',
            entityName: 'Jacob Shiohira',
          },
        ],
      },
    ],
    '60520-id',
    {
      entity: 'Zagreus',
      realmId: 'realm-z',
      accountNumber: '60520',
      accountName: 'Fringe Benefits',
    },
  )

  assert.equal(transactions.length, 2)
  assert.deepEqual(
    transactions.map((transaction) => transaction.name),
    ['Jonathan Wardell Avery', 'Jun Hee Kim'],
  )
})

test('prefers participant names parsed from Rippling descriptions for direct GL rows too', () => {
  const report = {
    Rows: {
      Row: [
        {
          type: 'Data',
          ColData: [
            { value: '2026-03-29' },
            { value: 'Journal Entry', id: 'je-203' },
            { value: 'Mar-26 Payroll' },
            { value: 'Jacob Shiohira' },
            { value: 'Engineering' },
            { value: '[Rippling] ICHRA Reimbursements for Jonathan Wardell Avery. Payroll run: Mar 16th - Mar 29th' },
            { value: '1200' },
            { value: '1200' },
          ],
        },
      ],
    },
  }

  const transactions = parseBudgetActualDrillTransactions(report, {
    entity: 'Zagreus',
    realmId: 'realm-z',
    accountNumber: '60520',
    accountName: 'Fringe Benefits',
  })

  assert.equal(transactions.length, 1)
  assert.equal(transactions[0]?.name, 'Jonathan Wardell Avery')
})

test('filters GL transactions for department and unclassified drill scopes', () => {
  const transactions = parseBudgetActualDrillTransactions(SAMPLE_REPORT, {
    entity: 'Opco',
    realmId: 'realm-1',
    accountNumber: '61110',
    accountName: 'AWS',
  })

  assert.equal(filterBudgetActualDrillTransactions(transactions, 'Engineering').length, 1)
  assert.equal(filterBudgetActualDrillTransactions(transactions, 'Not specified').length, 1)
  assert.equal(filterBudgetActualDrillTransactions(transactions, null).length, 2)
})

test('summarizes filtered transactions by account for the drill header', () => {
  const transactions = parseBudgetActualDrillTransactions(SAMPLE_REPORT, {
    entity: 'Opco',
    realmId: 'realm-1',
    accountNumber: '61110',
    accountName: 'AWS',
  })

  const summaries = summarizeBudgetActualDrillAccounts(transactions, {
    '61110': {
      mappingKeys: ['hosting'],
      mappingLines: ['Cloud Hosting & Compute'],
    },
  })

  assert.deepEqual(summaries, [
    {
      accountNumber: '61110',
      accountName: 'AWS',
      amountUsd: 300,
      transactionCount: 2,
      mappingKeys: ['hosting'],
      mappingLines: ['Cloud Hosting & Compute'],
    },
  ])
})

test('matches journal-entry vendor names by amount with a fallback', () => {
  assert.equal(
    pickBudgetActualDrillNameFromJournalEntry([
      { amount: 50, name: 'Vendor A' },
      { amount: 125, name: 'Vendor B' },
    ], 125),
    'Vendor B',
  )

  assert.equal(
    pickBudgetActualDrillNameFromJournalEntry([
      { amount: 50, name: 'Vendor A' },
      { amount: 75, name: 'Vendor B' },
    ], 125),
    'Vendor A',
  )
})

test('extracts participant names from Rippling descriptions', () => {
  assert.equal(
    pickBudgetActualDrillNameFromDescription('[Rippling] Salary for Rebecca Lara. Payroll run: Jan 19th - Feb 1st'),
    'Rebecca Lara',
  )
  assert.equal(pickBudgetActualDrillNameFromDescription('Vendor invoice'), null)
})
