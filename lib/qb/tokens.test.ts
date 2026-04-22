import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeQboExpiresAt,
  getQboConnectionStatus,
  isQboExpired,
  isQboExpiringSoon,
} from './tokens.ts'

test('computes QBO expiry with a safety skew', () => {
  const expiresAt = computeQboExpiresAt(3600, Date.UTC(2026, 3, 7, 12, 0, 0))
  assert.equal(expiresAt, '2026-04-07T12:59:00.000Z')
})

test('detects expired and soon-to-expire QBO connections', () => {
  const now = Date.UTC(2026, 3, 7, 12, 0, 0)
  assert.equal(isQboExpired('2026-04-07T11:59:59.000Z', now), true)
  assert.equal(isQboExpiringSoon('2026-04-07T12:03:00.000Z', now), true)
  assert.equal(isQboExpiringSoon('2026-04-07T12:10:01.000Z', now), false)
})

test('builds status flags from a QBO connection', () => {
  const status = getQboConnectionStatus({
    entity: 'Opco',
    realmId: '9341452247586809',
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: '2026-04-07T12:10:00.000Z',
    connectedBy: 'tester@orca.so',
    createdAt: '2026-04-07T11:00:00.000Z',
    updatedAt: '2026-04-07T11:30:00.000Z',
  }, Date.UTC(2026, 3, 7, 12, 0, 0))

  assert.deepEqual(status, {
    connected: true,
    expired: false,
    expiringSoon: false,
  })
})
