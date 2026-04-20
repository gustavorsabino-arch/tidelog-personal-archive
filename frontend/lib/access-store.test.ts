import test from 'node:test'
import assert from 'node:assert/strict'

import type { AccessRow } from './access-model.ts'
import { resolveLoadedAccessConfigFromLookup } from './access-store.ts'

test('prefers the canonical alias target over a conflicting direct access row', () => {
  const directRow: AccessRow = {
    email: 'person.alias@orca.so',
    role: 'admin',
  }
  const canonicalRow: AccessRow = {
    email: 'person@orca.so',
    role: 'budget_admin',
  }

  const resolved = resolveLoadedAccessConfigFromLookup({
    authEmail: 'person.alias@orca.so',
    directRow,
    aliasCanonicalEmail: 'person@orca.so',
    canonicalRow,
    budgetDepartments: ['Engineering'],
    budgetMonthIndices: [0, 1],
  })

  if (!resolved) throw new Error('Expected an access config for aliased user resolution.')
  assert.equal(resolved.row?.email, 'person@orca.so')
  assert.equal(resolved.row?.role, 'budget_admin')
  assert.equal(resolved.canonicalEmail, 'person@orca.so')
})

test('throws when an alias points to a missing canonical access row', () => {
  assert.throws(
    () => resolveLoadedAccessConfigFromLookup({
      authEmail: 'person.alias@orca.so',
      directRow: null,
      aliasCanonicalEmail: 'person@orca.so',
      canonicalRow: null,
      budgetDepartments: [],
      budgetMonthIndices: null,
    }),
    /configured as an alias/i,
  )
})

test('returns an unconfigured result when no direct row or alias target exists', () => {
  const resolved = resolveLoadedAccessConfigFromLookup({
    authEmail: 'unknown@orca.so',
    directRow: null,
    aliasCanonicalEmail: null,
    canonicalRow: null,
    budgetDepartments: [],
    budgetMonthIndices: null,
  })

  if (!resolved) throw new Error('Expected an unconfigured access result.')
  assert.equal(resolved.row, null)
  assert.equal(resolved.canonicalEmail, 'unknown@orca.so')
  assert.deepEqual(resolved.budgetDepartments, [])
  assert.equal(resolved.budgetMonthIndices, null)
})
