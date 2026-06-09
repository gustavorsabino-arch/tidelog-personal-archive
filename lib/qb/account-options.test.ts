import { test, expect } from 'bun:test'
import { toGlOptions, filterGlOptions, isOrphanValue, type QbAccountLite } from './account-options'

const ACCOUNTS: QbAccountLite[] = [
  { qbAccountNumber: '1010', qbAccountName: 'Cash' },
  { qbAccountNumber: '4010', qbAccountName: 'Revenue' },
]
test('toGlOptions maps to value/label', () => {
  expect(toGlOptions(ACCOUNTS)).toEqual([
    { value: '1010', label: '1010 · Cash' },
    { value: '4010', label: '4010 · Revenue' },
  ])
})
test('filter matches number', () => { expect(filterGlOptions(toGlOptions(ACCOUNTS), '40').map(o=>o.value)).toEqual(['4010']) })
test('filter matches name (ci)', () => { expect(filterGlOptions(toGlOptions(ACCOUNTS), 'cash').map(o=>o.value)).toEqual(['1010']) })
test('empty query returns all', () => { expect(filterGlOptions(toGlOptions(ACCOUNTS), '  ')).toHaveLength(2) })
test('orphan true when absent', () => { expect(isOrphanValue('9999', ACCOUNTS)).toBe(true) })
test('orphan false when present', () => { expect(isOrphanValue('1010', ACCOUNTS)).toBe(false) })
test('orphan false for null/empty', () => { expect(isOrphanValue(null, ACCOUNTS)).toBe(false); expect(isOrphanValue('', ACCOUNTS)).toBe(false) })
test('orphan false when catalog empty', () => { expect(isOrphanValue('1010', [])).toBe(false) })
