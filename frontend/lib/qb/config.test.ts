import test from 'node:test'
import assert from 'node:assert/strict'

import { BUDGET_QBO_ENTITIES, getQboEntityFromRealmId, getQboRealmId, isQboEntity } from './config.ts'

test('resolves QBO realm IDs for supported entities', () => {
  assert.equal(getQboRealmId('Opco'), '9341452247586809')
  assert.equal(getQboRealmId('Zagreus'), '9130352128221356')
})

test('resolves entities from realm IDs', () => {
  assert.equal(getQboEntityFromRealmId('9130357942134196'), 'Juku')
  assert.equal(getQboEntityFromRealmId('unknown'), null)
})

test('validates supported QBO entities', () => {
  assert.equal(isQboEntity('Foundation'), true)
  assert.equal(isQboEntity('Treasury'), false)
})

test('defines the budget QuickBooks subset without Juku', () => {
  assert.deepEqual(BUDGET_QBO_ENTITIES, ['Opco', 'Foundation', 'Zagreus'])
})
