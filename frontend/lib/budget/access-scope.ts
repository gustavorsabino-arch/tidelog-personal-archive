import type { AccessMeResponse } from '../access-model.ts'
import { canViewBudgetOverviewAllDepartments } from '../access-model.ts'
import { BUDGET_DEPTS } from '../constants.ts'
import type {
  BudgetDepartment,
  BudgetDepartmentPlan,
  BudgetPlanState,
  BudgetState,
  BudgetTeamMember,
  BudgetTeamState,
} from './types.ts'

function buildHiddenDepartmentPlan(plan: BudgetDepartmentPlan): BudgetDepartmentPlan {
  return {
    version: 1,
    year: plan.year,
    department: plan.department,
    periods: {},
    source: 'placeholder-static',
    importMeta: null,
  }
}

export function filterBudgetTeamMembersForAccess(
  members: BudgetTeamMember[],
  access: AccessMeResponse,
): BudgetTeamMember[] {
  if (access.role === 'admin' || access.permissions?.budgetDepartments === null) {
    return members
  }

  const allowedDepartments = new Set(access.permissions?.budgetDepartments ?? [])
  return members.filter((member) => allowedDepartments.has(member.dept))
}

export function filterBudgetTeamStateForAccess(
  team: BudgetTeamState,
  access: AccessMeResponse,
): BudgetTeamState {
  return {
    ...team,
    members: filterBudgetTeamMembersForAccess(team.members, access),
  }
}

export function filterBudgetPlanStateForAccess(
  plan: BudgetPlanState,
  access: AccessMeResponse,
): BudgetPlanState {
  if (canViewBudgetOverviewAllDepartments(access) || access.permissions?.budgetDepartments === null) {
    return plan
  }

  const allowedDepartments = new Set(access.permissions?.budgetDepartments ?? [])
  const departments = Object.fromEntries(
    BUDGET_DEPTS.map((department) => {
      const departmentPlan = plan.departments[department]
      return [
        department,
        allowedDepartments.has(department) ? departmentPlan : buildHiddenDepartmentPlan(departmentPlan),
      ]
    }),
  ) as Record<BudgetDepartment, BudgetDepartmentPlan>

  return {
    ...plan,
    departments,
  }
}

export function filterBudgetStateForAccess(
  state: BudgetState,
  access: AccessMeResponse,
): BudgetState {
  return {
    plan: filterBudgetPlanStateForAccess(state.plan, access),
    team: filterBudgetTeamStateForAccess(state.team, access),
  }
}
