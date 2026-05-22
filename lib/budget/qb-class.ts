import { BUDGET_DEPTS } from '../constants.ts'
import { normalizeBudgetDepartmentName, normalizeBudgetDepartmentToken } from './departments.ts'
import type { BudgetDepartment, BudgetDepartmentActualScope } from './types.ts'

export function normalizeBudgetQboClassToken(value: string): string {
  return normalizeBudgetDepartmentToken(value)
}

export function normalizeBudgetQboClassName(rawClassName: string | null | undefined): BudgetDepartment | null {
  return normalizeBudgetDepartmentName(rawClassName)
}

export function isBudgetDepartmentActualScope(value: string): value is BudgetDepartmentActualScope {
  return value === 'Not specified' || BUDGET_DEPTS.includes(value as BudgetDepartment)
}

export function isExcludedBudgetQboClassName(rawClassName: string | null | undefined): boolean {
  const value = String(rawClassName ?? '').trim().toLowerCase()
  if (!value) return false
  return value.split(':').some((segment) => segment.trim() === 'council')
}
