import test from 'node:test'
import assert from 'node:assert/strict'

import {
  filterBudgetPlanStateForAccess,
  filterBudgetStateForAccess,
  filterBudgetTeamStateForAccess,
} from './access-scope.ts'
import { getBudgetState } from './source.ts'
import {
  canViewBudgetOverviewAllDepartments,
  hasFullBudgetDepartmentAccess,
  resolveAccessUser,
  type AccessRow,
  type LoadedAccessConfig,
} from '../access-model.ts'

function buildConfig(
  row: AccessRow,
  overrides: Partial<LoadedAccessConfig> = {},
): LoadedAccessConfig {
  return {
    row,
    canonicalEmail: overrides.canonicalEmail ?? row.email,
    budgetDepartments: overrides.budgetDepartments ?? [],
    budgetMonthIndices: overrides.budgetMonthIndices ?? null,
  }
}

test('filters restricted budget state down to the configured department', () => {
  const state = getBudgetState()
  const access = resolveAccessUser(
    buildConfig(
      { email: 'eng@orca.so', role: 'restricted', budget_department: 'Engineering' } satisfies AccessRow,
      { budgetDepartments: ['Engineering'] },
    ),
    'eng@orca.so',
  )

  assert.ok(access)

  const filtered = filterBudgetStateForAccess(state, access)
  assert.equal(filtered.team.members.every((member) => member.dept === 'Engineering'), true)
  assert.equal(Object.keys(filtered.plan.departments.Engineering.periods).length > 0, true)
  assert.deepEqual(filtered.plan.departments.Marketing.periods, {})
})

test('keeps the full plan visible for budget-admin overview aggregation', () => {
  const state = getBudgetState()
  const access = resolveAccessUser(
    buildConfig(
      {
        email: 'budget@orca.so',
        role: 'budget_admin',
      } satisfies AccessRow,
      { budgetDepartments: [] },
    ),
    'budget@orca.so',
  )

  assert.ok(access)
  assert.equal(hasFullBudgetDepartmentAccess(access), true)
  assert.equal(canViewBudgetOverviewAllDepartments(access), true)
  const filteredPlan = filterBudgetPlanStateForAccess(state.plan, access)
  assert.equal(Object.keys(filteredPlan.departments.Engineering.periods).length > 0, true)
  assert.equal(Object.keys(filteredPlan.departments.Marketing.periods).length > 0, true)
  assert.equal(Object.keys(filteredPlan.departments.Legal.periods).length > 0, true)
  assert.equal(filterBudgetTeamStateForAccess(state.team, access).members.length, state.team.members.length)
})

test('filters restricted budget state down to multiple configured departments', () => {
  const state = getBudgetState()
  const access = resolveAccessUser(
    buildConfig(
      { email: 'multi@orca.so', role: 'restricted', budget_default_department: 'Engineering' } satisfies AccessRow,
      { budgetDepartments: ['Engineering', 'Marketing'] },
    ),
    'multi@orca.so',
  )

  assert.ok(access)

  const filtered = filterBudgetStateForAccess(state, access)
  assert.equal(filtered.team.members.every((member) => ['Engineering', 'Marketing'].includes(member.dept)), true)
  assert.equal(Object.keys(filtered.plan.departments.Engineering.periods).length > 0, true)
  assert.equal(Object.keys(filtered.plan.departments.Marketing.periods).length > 0, true)
  assert.deepEqual(filtered.plan.departments.Legal.periods, {})
})
