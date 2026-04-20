import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertAdminAccessAdminSafety,
  assertAdminAccessDeleteSafety,
  assertAdminAccessUserConflicts,
  getAdminAccessUserValidationError,
  prepareAdminAccessUserInput,
  validateAdminAccessUserInput,
  validateAdminBudgetViewerMonthNumbers,
  type AdminAccessUserRecord,
} from './admin-access-model.ts'

test('normalizes restricted user departments, default department, and aliases', () => {
  const normalized = validateAdminAccessUserInput({
    email: ' User@Orca.So ',
    role: 'restricted',
    budgetDefaultDepartment: 'Finance',
    departments: ['Marketing', 'Finance & Accounting', 'Finance', ''],
    aliases: ['user.alias@orca.so', 'USER.ALIAS@orca.so', 'user@orca.so'],
  })

  assert.deepEqual(normalized, {
    sourceEmail: null,
    email: 'user@orca.so',
    role: 'restricted',
    budgetDefaultDepartment: 'Finance',
    departments: ['Finance', 'Marketing'],
    aliases: ['user.alias@orca.so'],
  })
})

test('requires restricted users to have at least one department', () => {
  assert.throws(
    () => validateAdminAccessUserInput({
      email: 'viewer@orca.so',
      role: 'restricted',
      departments: [],
      aliases: [],
    }),
    /at least one department/i,
  )
})

test('clears budget admin department configuration because budget admins can view all departments', () => {
  const normalized = validateAdminAccessUserInput({
    email: 'budget.admin@orca.so',
    role: 'budget_admin',
    budgetDefaultDepartment: 'Finance',
    departments: ['Marketing', 'Finance', 'Finance & Accounting'],
    aliases: ['budget.admin.alias@orca.so'],
  })

  assert.deepEqual(normalized, {
    sourceEmail: null,
    email: 'budget.admin@orca.so',
    role: 'budget_admin',
    budgetDefaultDepartment: null,
    departments: [],
    aliases: ['budget.admin.alias@orca.so'],
  })
})

test('clears department configuration for full admins', () => {
  const normalized = validateAdminAccessUserInput({
    email: 'admin@orca.so',
    role: 'admin',
    budgetDefaultDepartment: 'Engineering',
    departments: ['Engineering'],
    aliases: ['admin.alias@orca.so'],
  })

  assert.equal(normalized.budgetDefaultDepartment, null)
  assert.deepEqual(normalized.departments, [])
  assert.deepEqual(normalized.aliases, ['admin.alias@orca.so'])
})

test('rejects conflicting aliases and canonical emails across users', () => {
  const normalized = validateAdminAccessUserInput({
    email: 'new.user@orca.so',
    role: 'restricted',
    departments: ['Engineering'],
    aliases: ['marketing@orca.so'],
  })

  const users: AdminAccessUserRecord[] = [
    {
      email: 'owner@orca.so',
      role: 'admin',
      budgetDefaultDepartment: null,
      departments: [],
      aliases: ['alias@orca.so'],
      createdAt: null,
      updatedAt: null,
    },
    {
      email: 'marketing@orca.so',
      role: 'restricted',
      budgetDefaultDepartment: 'Marketing',
      departments: ['Marketing'],
      aliases: [],
      createdAt: null,
      updatedAt: null,
    },
  ]

  assert.throws(
    () => assertAdminAccessUserConflicts(normalized, users),
    /canonical email/i,
  )
})

test('prevents demoting or deleting the last admin', () => {
  const users: AdminAccessUserRecord[] = [
    {
      email: 'only.admin@orca.so',
      role: 'admin',
      budgetDefaultDepartment: null,
      departments: [],
      aliases: [],
      createdAt: null,
      updatedAt: null,
    },
  ]

  const demoted = validateAdminAccessUserInput({
    sourceEmail: 'only.admin@orca.so',
    email: 'only.admin@orca.so',
    role: 'budget_admin',
    budgetDefaultDepartment: 'Engineering',
    departments: ['Engineering'],
    aliases: [],
  })

  assert.throws(() => assertAdminAccessAdminSafety(demoted, users), /at least one admin/i)
  assert.throws(() => assertAdminAccessDeleteSafety('only.admin@orca.so', users), /last configured admin/i)
})

test('preflight validation blocks demoting the last admin and returns the same message for the UI', () => {
  const users: AdminAccessUserRecord[] = [
    {
      email: 'only.admin@orca.so',
      role: 'admin',
      budgetDefaultDepartment: null,
      departments: [],
      aliases: [],
      createdAt: null,
      updatedAt: null,
    },
  ]

  assert.throws(
    () => prepareAdminAccessUserInput({
      sourceEmail: 'only.admin@orca.so',
      email: 'only.admin@orca.so',
      role: 'budget_admin',
      aliases: [],
    }, users),
    /at least one admin/i,
  )

  assert.equal(
    getAdminAccessUserValidationError({
      sourceEmail: 'only.admin@orca.so',
      email: 'only.admin@orca.so',
      role: 'budget_admin',
      aliases: [],
    }, users),
    'At least one admin must remain configured.',
  )
})

test('normalizes restricted viewer month configuration', () => {
  assert.deepEqual(validateAdminBudgetViewerMonthNumbers([2, 1, 2, 12]), [1, 2, 12])
  assert.throws(() => validateAdminBudgetViewerMonthNumbers([]), /at least one closed month/i)
})
