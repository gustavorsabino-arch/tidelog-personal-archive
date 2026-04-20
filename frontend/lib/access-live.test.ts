import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAccessRealtimeSubscriptionSpecs,
  getAccessRealtimeWatchedEmails,
} from './access-live.ts'
import type { AccessMeResponse } from './access-model.ts'

function buildAccess(overrides: Partial<AccessMeResponse> = {}): AccessMeResponse {
  return {
    email: overrides.email ?? 'person.alias@orca.so',
    canonicalEmail: overrides.canonicalEmail ?? 'person@orca.so',
    role: overrides.role ?? 'restricted',
    permissions: overrides.permissions ?? {
      allowedPages: ['budget'],
      budgetDepartments: ['Engineering'],
      budgetDefaultDepartment: 'Engineering',
      budgetTabs: ['overview'],
      canViewBudgetOverviewAllDepartments: false,
      canImportBudget: false,
      canManageBudgetTeam: false,
      budgetMonthIndices: [0, 1],
      budgetViewModes: ['month'],
      budgetEntities: ['All'],
      landingPage: '/budget',
    },
  }
}

test('watches auth, signed-in, and canonical emails without duplicates', () => {
  const watchedEmails = getAccessRealtimeWatchedEmails('PERSON.ALIAS@orca.so', buildAccess({
    email: 'person.alias@orca.so',
    canonicalEmail: 'person@orca.so',
  }))

  assert.deepEqual(watchedEmails, ['person.alias@orca.so', 'person@orca.so'])
})

test('builds year-scoped realtime subscriptions for configured aliased users', () => {
  const specs = buildAccessRealtimeSubscriptionSpecs('person.alias@orca.so', buildAccess(), 2026)

  assert.deepEqual(specs, [
    { table: 'user_access', filter: 'email=eq.person.alias@orca.so' },
    { table: 'user_access_departments', filter: 'email=eq.person.alias@orca.so' },
    { table: 'user_access', filter: 'email=eq.person@orca.so' },
    { table: 'user_access_departments', filter: 'email=eq.person@orca.so' },
    { table: 'user_access_aliases', filter: 'alias_email=eq.person.alias@orca.so' },
    { table: 'budget_access_settings', filter: 'year=eq.2026' },
  ])
})

test('keeps unaffiliated users subscribable before they receive an access row', () => {
  const specs = buildAccessRealtimeSubscriptionSpecs('new.user@orca.so', null, null)

  assert.deepEqual(specs, [
    { table: 'user_access', filter: 'email=eq.new.user@orca.so' },
    { table: 'user_access_departments', filter: 'email=eq.new.user@orca.so' },
    { table: 'user_access_aliases', filter: 'alias_email=eq.new.user@orca.so' },
  ])
})
