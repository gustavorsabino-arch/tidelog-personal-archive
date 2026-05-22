import test from 'node:test'
import assert from 'node:assert/strict'

import { enrichRowsWithClassFromPayloads } from './gl-class-enrich.ts'
import type { CachedTransactionPayload } from './cache-reads.ts'
import type { ParsedQboGeneralLedgerRow } from '../budget/qb-general-ledger.ts'

function makeRow(overrides: Partial<ParsedQboGeneralLedgerRow> = {}): ParsedQboGeneralLedgerRow {
  return {
    columnCount: 8,
    date: '2026-02-01',
    txnId: 'TX1',
    transactionType: 'Bill',
    documentNumber: null,
    name: null,
    className: null,
    memo: null,
    splitName: null,
    amountUsd: 100,
    runningBalanceUsd: null,
    ...overrides,
  }
}

function payloadMap(
  entries: Array<[txnId: string, resourceType: string, payload: unknown]>,
): Map<string, CachedTransactionPayload> {
  return new Map(
    entries.map(([txnId, resourceType, payload]) => [
      txnId,
      { txnId, resourceType, payload, fetchedAt: new Date('2026-05-21') },
    ]),
  )
}

test('enriches className when account + amount match a Bill line', () => {
  const rows = [makeRow({ txnId: 'TX1', amountUsd: 100 })]
  const map = payloadMap([[
    'TX1', 'bill',
    {
      Bill: {
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 100,
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: '60110', name: 'Salaries' },
              ClassRef: { value: 'C1', name: 'Engineering' },
            },
          },
        ],
      },
    },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.equal(enriched[0]?.className, 'Engineering')
})

test('preserves existing className — never overwrites', () => {
  const rows = [makeRow({ txnId: 'TX1', amountUsd: 100, className: 'Marketing' })]
  const map = payloadMap([[
    'TX1', 'bill',
    {
      Bill: {
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 100,
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: '60110' },
              ClassRef: { name: 'Engineering' },
            },
          },
        ],
      },
    },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  // Existing className wins — payload's "Engineering" must NOT replace it.
  assert.equal(enriched[0]?.className, 'Marketing')
})

test('returns row unchanged when payload missing from cache', () => {
  const rows = [makeRow({ txnId: 'TX-MISSING' })]
  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', new Map())
  assert.equal(enriched[0]?.className, null)
})

test('returns row unchanged when txnId is null', () => {
  const rows = [makeRow({ txnId: null })]
  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', new Map())
  assert.equal(enriched[0]?.className, null)
})

test('multi-line same-account different-amount: each row picks its own line', () => {
  const rows = [
    makeRow({ txnId: 'TX1', amountUsd: 100 }),
    makeRow({ txnId: 'TX1', amountUsd: 50 }),
  ]
  const map = payloadMap([[
    'TX1', 'journalentry',
    {
      JournalEntry: {
        Line: [
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 100,
            JournalEntryLineDetail: {
              AccountRef: { value: '60110' },
              ClassRef: { name: 'Engineering' },
              PostingType: 'Debit',
            },
          },
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 50,
            JournalEntryLineDetail: {
              AccountRef: { value: '60110' },
              ClassRef: { name: 'Marketing' },
              PostingType: 'Debit',
            },
          },
        ],
      },
    },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.equal(enriched[0]?.className, 'Engineering')
  assert.equal(enriched[1]?.className, 'Marketing')
})

test('amount sign mismatch (debit vs credit) still matches by magnitude', () => {
  // GL rows can be negative for credits even though payload Amount is the
  // positive line magnitude. We match on |amount|.
  const rows = [makeRow({ txnId: 'TX1', amountUsd: -100 })]
  const map = payloadMap([[
    'TX1', 'journalentry',
    {
      JournalEntry: {
        Line: [
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 100,
            JournalEntryLineDetail: {
              AccountRef: { value: '60110' },
              ClassRef: { name: 'Engineering' },
            },
          },
        ],
      },
    },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.equal(enriched[0]?.className, 'Engineering')
})

test('account does not match any line — className stays null', () => {
  const rows = [makeRow({ txnId: 'TX1', amountUsd: 100 })]
  const map = payloadMap([[
    'TX1', 'bill',
    {
      Bill: {
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 100,
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: '99999' },
              ClassRef: { name: 'Engineering' },
            },
          },
        ],
      },
    },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.equal(enriched[0]?.className, null)
})

test('matching line has no ClassRef — className stays null', () => {
  const rows = [makeRow({ txnId: 'TX1', amountUsd: 100 })]
  const map = payloadMap([[
    'TX1', 'journalentry',
    {
      JournalEntry: {
        Line: [
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 100,
            JournalEntryLineDetail: {
              AccountRef: { value: '60110' },
            },
          },
        ],
      },
    },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.equal(enriched[0]?.className, null)
})

test('unknown resource_type — no enrichment, no throw', () => {
  const rows = [makeRow({ txnId: 'TX1', amountUsd: 100 })]
  const map = payloadMap([[
    'TX1', 'check', // not in our wrapper map
    {
      Check: {
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 100,
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: '60110' },
              ClassRef: { name: 'Engineering' },
            },
          },
        ],
      },
    },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.equal(enriched[0]?.className, null)
})

test('malformed payload (Line not an array) — caught, no throw', () => {
  const rows = [makeRow({ txnId: 'TX1', amountUsd: 100 })]
  const map = payloadMap([[
    'TX1', 'bill',
    { Bill: { Line: 'not-an-array' } },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.equal(enriched[0]?.className, null)
})

test('all six known wrapper keys resolve correctly', () => {
  // For each known resource type, an Engineering-class line on account 60110
  // amount 100 must enrich the row to className='Engineering'.
  const cases: Array<[string, string, string]> = [
    ['bill', 'Bill', 'AccountBasedExpenseLineDetail'],
    ['purchase', 'Purchase', 'AccountBasedExpenseLineDetail'],
    ['vendorcredit', 'VendorCredit', 'AccountBasedExpenseLineDetail'],
    ['journalentry', 'JournalEntry', 'JournalEntryLineDetail'],
    ['deposit', 'Deposit', 'DepositLineDetail'],
    ['invoice', 'Invoice', 'SalesItemLineDetail'],
  ]

  for (const [resourceType, wrapperKey, detailKey] of cases) {
    const row = makeRow({ txnId: `TX-${resourceType}`, amountUsd: 100 })
    const map = payloadMap([[
      row.txnId!, resourceType,
      {
        [wrapperKey]: {
          Line: [
            {
              DetailType: detailKey,
              Amount: 100,
              [detailKey]: {
                AccountRef: { value: '60110' },
                ClassRef: { name: 'Engineering' },
              },
            },
          ],
        },
      },
    ]])

    const enriched = enrichRowsWithClassFromPayloads([row], '60110', map)
    assert.equal(
      enriched[0]?.className,
      'Engineering',
      `wrapper resolution failed for resourceType=${resourceType}`,
    )
  }
})

test('amount-only-collision falls back to first account match', () => {
  // Both lines on account 60110, both Amount=100, but different classes.
  // First-account-match wins. Documented behavior — drift is tiny because
  // identical (account, amount) duplicates in QB are vanishingly rare.
  const rows = [makeRow({ txnId: 'TX1', amountUsd: 100 })]
  const map = payloadMap([[
    'TX1', 'journalentry',
    {
      JournalEntry: {
        Line: [
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 100,
            JournalEntryLineDetail: {
              AccountRef: { value: '60110' },
              ClassRef: { name: 'Engineering' },
            },
          },
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: 100,
            JournalEntryLineDetail: {
              AccountRef: { value: '60110' },
              ClassRef: { name: 'Marketing' },
            },
          },
        ],
      },
    },
  ]])

  const enriched = enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.equal(enriched[0]?.className, 'Engineering')
})

test('does not mutate input rows', () => {
  const rows = [makeRow({ txnId: 'TX1', amountUsd: 100 })]
  const original = JSON.parse(JSON.stringify(rows))
  const map = payloadMap([[
    'TX1', 'bill',
    {
      Bill: {
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: 100,
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: '60110' },
              ClassRef: { name: 'Engineering' },
            },
          },
        ],
      },
    },
  ]])

  enrichRowsWithClassFromPayloads(rows, '60110', map)
  assert.deepEqual(rows, original, 'enrichment must not mutate input array')
})
