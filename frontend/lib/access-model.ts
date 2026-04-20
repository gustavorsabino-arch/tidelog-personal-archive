import type { BudgetEntityScope, BudgetViewMode } from './budget/types.ts'
import { normalizeBudgetDepartmentName } from './budget/departments.ts'

export type AccessRole = 'admin' | 'budget_admin' | 'restricted'

export type AccessRow = {
  email: string
  role: AccessRole
  budget_department?: string | null
  budget_default_department?: string | null
}

export type LoadedAccessConfig = {
  row: AccessRow | null
  canonicalEmail: string | null
  budgetDepartments: string[]
  budgetMonthIndices: number[] | null
}

export type AccessPermissions = {
  allowedPages: string[]
  budgetDepartments: string[] | null
  budgetDefaultDepartment: string | null
  budgetTabs: string[]
  canViewBudgetOverviewAllDepartments: boolean
  canImportBudget: boolean
  canManageBudgetTeam: boolean
  budgetMonthIndices: number[] | null
  budgetViewModes: BudgetViewMode[]
  budgetEntities: BudgetEntityScope[] | null
  landingPage: string
}

export type AccessMeResponse = {
  email: string
  canonicalEmail: string
  role: AccessRole
  permissions: AccessPermissions | null
}

export const FULL_BUDGET_TABS = ['overview', 'departments', 'headcount', 'team', 'mapping', 'coverage'] as const
// Budget admins can view every department on the overview, so they land on a single
// Overview tab that aggregates across departments. Restricted users are
// department-scoped — showing them the Overview tab silently renders a department
// report under a misleading label, so they get the Department tab directly instead.
const BUDGET_ADMIN_TABS = ['overview']
const RESTRICTED_BUDGET_TABS = ['departments']
const FULL_BUDGET_VIEW_MODES: BudgetViewMode[] = ['ytd', 'month', 'range']
const RESTRICTED_BUDGET_VIEW_MODES: BudgetViewMode[] = ['month']

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeDepartment(value: string | null | undefined): string | null {
  if (!value) return null
  return normalizeBudgetDepartmentName(value)
}

function normalizeDepartments(departments: readonly string[]): string[] {
  return Array.from(
    new Set(
      departments
        .map((department) => normalizeDepartment(department))
        .filter((department): department is string => department !== null),
    ),
  )
}

function pickDefaultDepartment(
  requestedDefault: string | null | undefined,
  departments: readonly string[],
): string | null {
  const normalizedDefault = normalizeDepartment(requestedDefault)
  if (normalizedDefault && departments.includes(normalizedDefault)) {
    return normalizedDefault
  }

  return departments[0] ?? null
}

function normalizeBudgetMonthIndices(monthIndices: readonly number[] | null | undefined): number[] | null {
  if (!monthIndices || monthIndices.length === 0) return null

  const normalized = Array.from(
    new Set(
      monthIndices
        .filter((monthIndex) => Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11),
    ),
  ).sort((left, right) => left - right)

  return normalized.length > 0 ? normalized : null
}

function permissionsForRole(config: LoadedAccessConfig): AccessPermissions | null {
  const user = config.row
  if (!user || user.role === 'admin') return null

  if (user.role === 'budget_admin') {
    return {
      allowedPages: ['budget'],
      budgetDepartments: null,
      budgetDefaultDepartment: null,
      budgetTabs: [...BUDGET_ADMIN_TABS],
      canViewBudgetOverviewAllDepartments: true,
      canImportBudget: true,
      canManageBudgetTeam: false,
      budgetMonthIndices: normalizeBudgetMonthIndices(config.budgetMonthIndices),
      budgetViewModes: [...RESTRICTED_BUDGET_VIEW_MODES],
      budgetEntities: ['All'],
      landingPage: '/budget',
    }
  }

  const budgetDepartments = normalizeDepartments(config.budgetDepartments)
  const budgetDefaultDepartment = pickDefaultDepartment(
    user.budget_default_department ?? user.budget_department ?? null,
    budgetDepartments,
  )

  return {
    allowedPages: ['budget'],
    budgetDepartments,
    budgetDefaultDepartment,
    budgetTabs: [...RESTRICTED_BUDGET_TABS],
    canViewBudgetOverviewAllDepartments: false,
    canImportBudget: false,
    canManageBudgetTeam: false,
    budgetMonthIndices: normalizeBudgetMonthIndices(config.budgetMonthIndices),
    budgetViewModes: [...RESTRICTED_BUDGET_VIEW_MODES],
    budgetEntities: ['All'],
    landingPage: '/budget',
  }
}

export function resolveAccessUser(config: LoadedAccessConfig | null, email: string): AccessMeResponse | null {
  const normalizedEmail = normalizeEmail(email)
  const canonicalEmail = normalizeEmail(config?.canonicalEmail ?? normalizedEmail)

  if (config?.row) {
    return {
      email: normalizedEmail,
      canonicalEmail,
      role: config.row.role,
      permissions: permissionsForRole(config),
    }
  }

  return null
}

export function hasBudgetPageAccess(access: AccessMeResponse | null): boolean {
  if (!access) return false
  if (access.role === 'admin') return true
  return (access.permissions?.allowedPages ?? []).includes('budget')
}

export function getVisibleBudgetTabs(access: AccessMeResponse | null): string[] {
  if (!access) return []
  if (access.role === 'admin') return [...FULL_BUDGET_TABS]
  return [...(access.permissions?.budgetTabs ?? [])]
}

export function canAccessBudgetTab(access: AccessMeResponse | null, tab: string): boolean {
  return getVisibleBudgetTabs(access).includes(tab)
}

export function getAllowedPages(access: AccessMeResponse | null): string[] | null {
  if (!access) return []
  if (access.role === 'admin') return null
  return access.permissions?.allowedPages ?? []
}

export function hasFullBudgetDepartmentAccess(access: AccessMeResponse | null): boolean {
  if (!access) return false
  if (access.role === 'admin') return true
  return access.permissions?.budgetDepartments === null
}

export function canViewBudgetOverviewAllDepartments(access: AccessMeResponse | null): boolean {
  if (!access) return false
  if (access.role === 'admin') return true
  return access.permissions?.canViewBudgetOverviewAllDepartments ?? false
}

export function isBudgetOnlyUser(access: AccessMeResponse | null): boolean {
  const allowedPages = getAllowedPages(access)
  return Array.isArray(allowedPages) && allowedPages.length === 1 && allowedPages[0] === 'budget'
}

export function getAllowedBudgetDepartments(access: AccessMeResponse | null): string[] | null {
  if (!access) return []
  if (access.role === 'admin') return null
  return access.permissions?.budgetDepartments ?? null
}

export function getDefaultBudgetDepartment(access: AccessMeResponse | null): string | null {
  if (!access || access.role === 'admin') return null
  return access.permissions?.budgetDefaultDepartment ?? null
}

export function canViewBudgetDepartment(access: AccessMeResponse | null, department: string): boolean {
  const allowedDepartments = getAllowedBudgetDepartments(access)
  if (allowedDepartments === null) return true
  return allowedDepartments.includes(normalizeDepartment(department) ?? department)
}

export function getAllowedBudgetMonthIndices(access: AccessMeResponse | null): number[] | null {
  if (!access || access.role === 'admin') return null
  return access.permissions?.budgetMonthIndices ?? null
}

export function getAllowedBudgetViewModes(access: AccessMeResponse | null): BudgetViewMode[] {
  if (!access || access.role === 'admin') return [...FULL_BUDGET_VIEW_MODES]
  return [...(access.permissions?.budgetViewModes ?? FULL_BUDGET_VIEW_MODES)]
}

export function getAllowedBudgetEntities(access: AccessMeResponse | null): BudgetEntityScope[] | null {
  if (!access || access.role === 'admin') return null
  return access.permissions?.budgetEntities ?? null
}

export function getBudgetViewRestrictions(access: AccessMeResponse | null) {
  return {
    allowedMonthIndices: getAllowedBudgetMonthIndices(access),
    allowedModes: getAllowedBudgetViewModes(access),
    allowedEntities: getAllowedBudgetEntities(access),
  }
}

export function canImportBudget(access: AccessMeResponse | null): boolean {
  if (!access) return false
  if (access.role === 'admin') return true
  return access.permissions?.canImportBudget ?? false
}

export function canManageBudgetTeam(access: AccessMeResponse | null): boolean {
  if (!access) return false
  if (access.role === 'admin') return true
  return access.permissions?.canManageBudgetTeam ?? false
}
