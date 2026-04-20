import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldRefreshAccessForAuthEvent } from './access-refresh.ts'

test('refreshes access when auth email identity changes', () => {
  assert.equal(
    shouldRefreshAccessForAuthEvent('SIGNED_IN', null, 'person@orca.so'),
    true,
  )
  assert.equal(
    shouldRefreshAccessForAuthEvent('SIGNED_OUT', 'person@orca.so', null),
    true,
  )
  assert.equal(
    shouldRefreshAccessForAuthEvent('SIGNED_IN', 'person@orca.so', 'other@orca.so'),
    true,
  )
})

test('does not refresh access for token or focus churn when identity stays the same', () => {
  assert.equal(
    shouldRefreshAccessForAuthEvent('TOKEN_REFRESHED', 'person@orca.so', 'person@orca.so'),
    false,
  )
  assert.equal(
    shouldRefreshAccessForAuthEvent('SIGNED_IN', 'person@orca.so', 'person@orca.so'),
    false,
  )
})

test('refreshes access for same-identity user updates', () => {
  assert.equal(
    shouldRefreshAccessForAuthEvent('USER_UPDATED', 'person@orca.so', 'person@orca.so'),
    true,
  )
})
