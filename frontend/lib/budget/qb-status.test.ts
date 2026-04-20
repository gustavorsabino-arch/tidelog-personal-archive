import test from 'node:test'
import assert from 'node:assert/strict'

import type { QboConnectionStatus } from '@/lib/qb/types'

import {
  canFetchBudgetActuals,
  formatQboStatusSummary,
  getMissingQboEntities,
  getRequiredQboEntities,
} from './qb-status.ts'

const STATUSES: QboConnectionStatus[] = [
  {
    entity: 'Opco',
    realmId: '1',
    connected: true,
    expiresAt: null,
    expired: false,
    expiringSoon: false,
    updatedAt: null,
  },
  {
    entity: 'Foundation',
    realmId: '2',
    connected: false,
    expiresAt: null,
    expired: false,
    expiringSoon: false,
    updatedAt: null,
  },
  {
    entity: 'Juku',
    realmId: '3',
    connected: true,
    expiresAt: null,
    expired: false,
    expiringSoon: false,
    updatedAt: null,
  },
  {
    entity: 'Zagreus',
    realmId: '4',
    connected: true,
    expiresAt: null,
    expired: false,
    expiringSoon: false,
    updatedAt: null,
  },
]

test('returns all entities when the budget scope is All', () => {
  assert.deepEqual(getRequiredQboEntities('All'), ['Opco', 'Foundation', 'Zagreus'])
})

test('returns the scoped entity when the budget scope is a single entity', () => {
  assert.deepEqual(getRequiredQboEntities('Opco'), ['Opco'])
})

test('reports missing QBO entities for the selected scope', () => {
  assert.deepEqual(getMissingQboEntities('All', STATUSES), ['Foundation'])
  assert.deepEqual(getMissingQboEntities('Opco', STATUSES), [])
})

test('detects when budget actuals can be fetched', () => {
  assert.equal(canFetchBudgetActuals('All', STATUSES), false)
  assert.equal(canFetchBudgetActuals('Opco', STATUSES), true)
})

test('formats a compact QB status summary', () => {
  assert.equal(formatQboStatusSummary('All', STATUSES), 'QB: 2/3 connected')
})
