import test from 'node:test'
import assert from 'node:assert/strict'

import { createQboOAuthState, isQboOAuthStateFresh, parseQboOAuthState } from './oauth.ts'

const SECRET = 'qbo-test-secret'

test('creates and parses a signed QBO OAuth state payload', () => {
  const state = createQboOAuthState(
    { entity: 'Opco', realmId: '9341452247586809', ts: Date.UTC(2026, 3, 7, 10, 0, 0) },
    SECRET,
  )

  assert.deepEqual(parseQboOAuthState(state, SECRET), {
    entity: 'Opco',
    realmId: '9341452247586809',
    ts: Date.UTC(2026, 3, 7, 10, 0, 0),
  })
})

test('rejects tampered QBO OAuth state payloads', () => {
  const state = createQboOAuthState(
    { entity: 'Opco', realmId: '9341452247586809', ts: Date.UTC(2026, 3, 7, 10, 0, 0) },
    SECRET,
  )
  const tampered = `${state}x`

  assert.equal(parseQboOAuthState(tampered, SECRET), null)
})

test('rejects QBO OAuth state payloads that do not match the entity realm mapping', () => {
  const state = createQboOAuthState(
    { entity: 'Opco', realmId: '9130357942134196', ts: Date.UTC(2026, 3, 7, 10, 0, 0) },
    SECRET,
  )

  assert.equal(parseQboOAuthState(state, SECRET), null)
})

test('checks QBO OAuth state freshness', () => {
  const payload = {
    entity: 'Opco' as const,
    realmId: '9341452247586809',
    ts: Date.UTC(2026, 3, 7, 10, 0, 0),
  }

  assert.equal(isQboOAuthStateFresh(payload, Date.UTC(2026, 3, 7, 10, 30, 0)), true)
  assert.equal(isQboOAuthStateFresh(payload, Date.UTC(2026, 3, 7, 12, 30, 1)), false)
})
