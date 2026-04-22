import type { ServerUser } from '@/lib/auth/get-user'
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

export function canViewAllBudgetDepartments(user: ServerUser): boolean {
  return user.role === 'admin'
}

export function canViewBudgetDepartment(user: ServerUser, department: string): boolean {
  if (user.role === 'admin') return true
  return user.departments.includes(department)
}

/**
 * Returns the list of departments this user can see, or null if they can see
 * all of them. Pass this into `loadBudgetPlanState(year, noCache, dept)` so
 * the DB query is already scoped at read time.
 */
export function getAllowedBudgetDepartmentsForUser(user: ServerUser): BudgetDepartment[] | null {
  if (canViewAllBudgetDepartments(user)) return null
  return user.departments.filter((d): d is BudgetDepartment =>
    (BUDGET_DEPTS as readonly string[]).includes(d),
  )
}

export function filterBudgetTeamMembersForAccess(
  members: BudgetTeamMember[],
  user: ServerUser,
): BudgetTeamMember[] {
  if (canViewAllBudgetDepartments(user)) return members
  const allowed = new Set(user.departments)
  return members.filter((member) => allowed.has(member.dept))
}

export function filterBudgetTeamStateForAccess(
  team: BudgetTeamState,
  user: ServerUser,
): BudgetTeamState {
  return {
    ...team,
    members: filterBudgetTeamMembersForAccess(team.members, user),
  }
}

export function filterBudgetPlanStateForAccess(
  plan: BudgetPlanState,
  user: ServerUser,
): BudgetPlanState {
  if (canViewAllBudgetDepartments(user)) return plan

  const allowed = new Set(user.departments)
  const departments = Object.fromEntries(
    BUDGET_DEPTS.map((department) => {
      const departmentPlan = plan.departments[department]
      return [
        department,
        allowed.has(department) ? departmentPlan : buildHiddenDepartmentPlan(departmentPlan),
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
  user: ServerUser,
): BudgetState {
  return {
    plan: filterBudgetPlanStateForAccess(state.plan, user),
    team: filterBudgetTeamStateForAccess(state.team, user),
  }
}
