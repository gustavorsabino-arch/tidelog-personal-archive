/**
 * UI-facing access model.
 *
 * Back-compat shim over the v2 auth system: Cloudflare Access handles
 * authentication, `ServerUser` describes what a user is allowed to do. This
 * module re-exposes that with the legacy helper surface so existing UI code
 * keeps working without a sweeping refactor.
 *
 * The response shape is whatever `GET /api/me` returns (see
 * `app/api/me/route.ts`). The `access-context` hook populates it once per
 * session and caches via React context.
 */

import type { BudgetDepartment, BudgetEntityScope, BudgetViewMode } from '@/lib/budget/types'

export type Role = 'admin' | 'budget_viewer'

export type AccessPermissions = {
  budgetDepartments: BudgetDepartment[] | null  // null = all
  canImportBudget: boolean
  canManageBudgetTeam: boolean
}

export type AccessMeResponse = {
  email: string
  role: Role | null
  departments: string[]
  permissions: AccessPermissions
}

/** Pages the sidebar may show. `null` means no restriction (admin). */
export function getAllowedPages(access: AccessMeResponse | null): string[] | null {
  if (!access || !access.role) return []
  if (access.role === 'admin') return null
  // budget_viewer: budget + the approvals submission workflow
  return ['budget', 'approvals']
}

export function isBudgetOnlyUser(access: AccessMeResponse | null): boolean {
  return access?.role === 'budget_viewer'
}

export function hasBudgetPageAccess(access: AccessMeResponse | null): boolean {
  return access?.role === 'admin' || access?.role === 'budget_viewer'
}

export function canViewBudgetOverviewAllDepartments(access: AccessMeResponse | null): boolean {
  return access?.role === 'admin'
}

/** v1 had per-user entity restrictions; v2 doesn't. `null` = all entities. */
export function getAllowedBudgetEntities(_access: AccessMeResponse | null): readonly BudgetEntityScope[] | null {
  return null
}

/** v1 had per-user view-mode restrictions; v2 doesn't. `null` = all modes. */
export function getAllowedBudgetViewModes(_access: AccessMeResponse | null): readonly BudgetViewMode[] | null {
  return null
}

export function getDefaultBudgetDepartment(access: AccessMeResponse | null): string | null {
  if (!access) return null
  if (access.role === 'admin') return null // admin → "All"
  return access.departments[0] ?? null
}

const ADMIN_BUDGET_TABS = ['overview', 'headcount', 'team', 'mapping', 'coverage']
const VIEWER_BUDGET_TABS = ['overview']

export function getVisibleBudgetTabs(access: AccessMeResponse | null): string[] {
  if (!access || !access.role) return []
  if (access.role === 'admin') return [...ADMIN_BUDGET_TABS]
  return [...VIEWER_BUDGET_TABS]
}

export function canAccessBudgetTab(access: AccessMeResponse | null, tab: string): boolean {
  return getVisibleBudgetTabs(access).includes(tab)
}

export function canViewBudgetDepartment(access: AccessMeResponse | null, dept: string): boolean {
  if (!access) return false
  if (access.role === 'admin') return true
  return access.departments.includes(dept)
}

export function getAllowedBudgetDepartments(access: AccessMeResponse | null): BudgetDepartment[] | null {
  if (!access) return []
  return access.permissions.budgetDepartments
}

export function getAllowedBudgetMonthIndices(_access: AccessMeResponse | null): number[] | null {
  // No per-user month restrictions in v2.
  return null
}

export function canImportBudget(access: AccessMeResponse | null): boolean {
  return access?.permissions.canImportBudget === true
}

export function canManageBudgetTeam(access: AccessMeResponse | null): boolean {
  return access?.permissions.canManageBudgetTeam === true
}

export function getBudgetViewRestrictions(_access: AccessMeResponse | null): Record<string, unknown> {
  return {}
}
