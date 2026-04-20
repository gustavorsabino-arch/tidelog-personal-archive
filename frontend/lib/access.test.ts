import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canAccessBudgetTab,
  canImportBudget,
  canManageBudgetTeam,
  canViewBudgetOverviewAllDepartments,
  canViewBudgetDepartment,
  getAllowedBudgetEntities,
  getAllowedBudgetMonthIndices,
  getAllowedBudgetViewModes,
  getDefaultBudgetDepartment,
  getVisibleBudgetTabs,
  hasBudgetPageAccess,
  hasFullBudgetDepartmentAccess,
  resolveAccessUser,
  type LoadedAccessConfig,
  type AccessRow,
} from './access-model.ts'

function buildConfig(
  row: AccessRow | null,
  overrides: Partial<LoadedAccessConfig> = {},
): LoadedAccessConfig | null {
  if (!row && !overrides.canonicalEmail) return null

  return {
    row,
    canonicalEmail: overrides.canonicalEmail ?? row?.email ?? null,
    budgetDepartments: overrides.budgetDepartments ?? [],
    budgetMonthIndices: overrides.budgetMonthIndices ?? null,
  }
}

test('resolves budget admin and import permission from config', () => {
  const row: AccessRow = {
    email: 'budget@orca.so',
    role: 'budget_admin',
  }
  const access = resolveAccessUser(buildConfig(row, {
    budgetDepartments: ['Engineering', 'Marketing'],
    budgetMonthIndices: [0, 1],
  }), 'budget@orca.so')
  assert.ok(access)
  assert.equal(access.role, 'budget_admin')
  assert.equal(canImportBudget(access), true)
  assert.equal(canManageBudgetTeam(access), false)
  assert.equal(hasFullBudgetDepartmentAccess(access), true)
  assert.equal(canViewBudgetOverviewAllDepartments(access), true)
  assert.equal(access.permissions?.budgetDepartments, null)
  assert.equal(getDefaultBudgetDepartment(access), null)
  assert.deepEqual(getAllowedBudgetMonthIndices(access), [0, 1])
  assert.deepEqual(getAllowedBudgetViewModes(access), ['month'])
  assert.deepEqual(getAllowedBudgetEntities(access), ['All'])
  assert.deepEqual(getVisibleBudgetTabs(access), ['overview'])
  assert.equal(canAccessBudgetTab(access, 'overview'), true)
  assert.equal(canAccessBudgetTab(access, 'departments'), false)
  assert.equal(canViewBudgetDepartment(access, 'Engineering'), true)
  assert.equal(canViewBudgetDepartment(access, 'Legal'), true)
})

test('resolves restricted user with department-scoped overview permissions', () => {
  const row: AccessRow = {
    email: 'eng@orca.so',
    role: 'restricted',
    budget_department: 'Engineering',
    budget_default_department: 'Marketing',
  }
  const access = resolveAccessUser(buildConfig(row, {
    budgetDepartments: ['Engineering', 'Marketing'],
    budgetMonthIndices: [0, 1],
  }), 'eng@orca.so')
  assert.ok(access)
  assert.equal(access.role, 'restricted')
  assert.deepEqual(access.permissions?.budgetDepartments, ['Engineering', 'Marketing'])
  assert.equal(getDefaultBudgetDepartment(access), 'Marketing')
  assert.deepEqual(getAllowedBudgetMonthIndices(access), [0, 1])
  assert.deepEqual(getAllowedBudgetViewModes(access), ['month'])
  assert.deepEqual(getAllowedBudgetEntities(access), ['All'])
  assert.deepEqual(getVisibleBudgetTabs(access), ['departments'])
  assert.equal(hasFullBudgetDepartmentAccess(access), false)
  assert.equal(canViewBudgetOverviewAllDepartments(access), false)
  assert.equal(canAccessBudgetTab(access, 'departments'), true)
  assert.equal(canAccessBudgetTab(access, 'overview'), false)
  assert.equal(canImportBudget(access), false)
  assert.equal(canManageBudgetTeam(access), false)
  assert.equal(canViewBudgetDepartment(access, 'Engineering'), true)
  assert.equal(canViewBudgetDepartment(access, 'Marketing'), true)
  assert.equal(canViewBudgetDepartment(access, 'Legal'), false)
})

test('normalizes legacy budget department grants from access config', () => {
  const row: AccessRow = {
    email: 'finance@orca.so',
    role: 'restricted',
    budget_department: 'Finance',
    budget_default_department: 'Biz Dev',
  }
  const access = resolveAccessUser(buildConfig(row, {
    budgetDepartments: ['Finance', 'Business Development'],
    budgetMonthIndices: [0, 1],
  }), 'finance@orca.so')

  assert.ok(access)
  assert.deepEqual(access.permissions?.budgetDepartments, ['Finance', 'Business Development'])
  assert.equal(getDefaultBudgetDepartment(access), 'Business Development')
  assert.equal(canViewBudgetDepartment(access, 'Finance & Accounting'), true)
  assert.equal(canViewBudgetDepartment(access, 'Finance'), true)
})

test('denies unconfigured users until they are explicitly provisioned', () => {
  const access = resolveAccessUser(null, 'unknown@orca.so')
  assert.equal(access, null)
  assert.equal(hasBudgetPageAccess(access), false)
  assert.equal(canImportBudget(access), false)
  assert.equal(canManageBudgetTeam(access), false)
})

test('restricted users land on Department (not Overview) because their Overview would silently be dept-scoped', () => {
  const row: AccessRow = {
    email: 'eng@orca.so',
    role: 'restricted',
    budget_department: 'Engineering',
  }
  const access = resolveAccessUser(buildConfig(row, {
    budgetDepartments: ['Engineering'],
  }), 'eng@orca.so')
  assert.ok(access)
  assert.deepEqual(getVisibleBudgetTabs(access), ['departments'])
  assert.equal(canAccessBudgetTab(access, 'overview'), false)
  assert.equal(canAccessBudgetTab(access, 'departments'), true)
})

test('budget admins still see the Overview tab because they can view all departments', () => {
  const row: AccessRow = {
    email: 'budget@orca.so',
    role: 'budget_admin',
  }
  const access = resolveAccessUser(buildConfig(row, {
    budgetDepartments: [],
  }), 'budget@orca.so')
  assert.ok(access)
  assert.deepEqual(getVisibleBudgetTabs(access), ['overview'])
  assert.equal(canAccessBudgetTab(access, 'overview'), true)
  assert.equal(canAccessBudgetTab(access, 'departments'), false)
})

test('requires a configured database row even for formerly allowlisted emails', () => {
  const access = resolveAccessUser(null, 'amina@orca.so')
  assert.equal(access, null)
})

test('uses configured database roles for aliased users', () => {
  const row: AccessRow = {
    email: 'amina@orca.so',
    role: 'restricted',
    budget_department: 'Engineering',
  }
  const access = resolveAccessUser(buildConfig(row, {
    canonicalEmail: 'amina@orca.so',
    budgetDepartments: ['Engineering'],
  }), 'am.lopez@orca.so')

  assert.ok(access)
  assert.equal(access.role, 'restricted')
  assert.equal(access.canonicalEmail, 'amina@orca.so')
  assert.equal(canImportBudget(access), false)
  assert.deepEqual(getVisibleBudgetTabs(access), ['departments'])
})
