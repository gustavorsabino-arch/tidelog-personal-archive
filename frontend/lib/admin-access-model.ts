import { BUDGET_DEPTS } from './constants.ts'
import { normalizeEmail, type AccessRole } from './access-model.ts'
import { normalizeBudgetDepartmentName } from './budget/departments.ts'
import type { BudgetDepartment } from './budget/types.ts'

export type AdminAccessUserRecord = {
  email: string
  role: AccessRole
  budgetDefaultDepartment: BudgetDepartment | null
  departments: BudgetDepartment[]
  aliases: string[]
  createdAt: string | null
  updatedAt: string | null
}

export type AdminBudgetViewerSettings = {
  year: number
  viewerMonthNumbers: number[]
}

export type AdminAccessSnapshot = {
  users: AdminAccessUserRecord[]
  viewerSettings: AdminBudgetViewerSettings
}

export type AdminAccessUserInput = {
  sourceEmail?: string | null
  email: string
  role: AccessRole
  budgetDefaultDepartment?: string | null
  departments?: string[] | null
  aliases?: string[] | null
}

export type NormalizedAdminAccessUserInput = {
  sourceEmail: string | null
  email: string
  role: AccessRole
  budgetDefaultDepartment: BudgetDepartment | null
  departments: BudgetDepartment[]
  aliases: string[]
}

const ACCESS_ROLES: AccessRole[] = ['admin', 'budget_admin', 'restricted']
const BUDGET_DEPARTMENT_INDEX = new Map(BUDGET_DEPTS.map((department, index) => [department, index]))

function usesDepartmentScopedBudgetAccess(role: AccessRole): boolean {
  return role === 'restricted'
}

function isOrcaEmail(email: string): boolean {
  return email.endsWith('@orca.so')
}

function isAccessRole(value: unknown): value is AccessRole {
  return typeof value === 'string' && ACCESS_ROLES.includes(value as AccessRole)
}

function sortBudgetDepartments(departments: readonly BudgetDepartment[]): BudgetDepartment[] {
  return [...departments].sort((left, right) => (
    (BUDGET_DEPARTMENT_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (BUDGET_DEPARTMENT_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER)
  ))
}

function normalizeDepartmentList(departments: readonly string[]): {
  departments: BudgetDepartment[]
  unknownDepartments: string[]
} {
  const uniqueDepartments = new Set<BudgetDepartment>()
  const unknownDepartments = new Set<string>()

  for (const department of departments) {
    const rawValue = String(department ?? '').trim()
    if (!rawValue) continue

    const normalized = normalizeBudgetDepartmentName(rawValue)
    if (normalized) {
      uniqueDepartments.add(normalized)
    } else {
      unknownDepartments.add(rawValue)
    }
  }

  return {
    departments: sortBudgetDepartments(Array.from(uniqueDepartments)),
    unknownDepartments: Array.from(unknownDepartments).sort((left, right) => left.localeCompare(right)),
  }
}

function normalizeAliasList(aliases: readonly string[], canonicalEmail: string): string[] {
  return Array.from(
    new Set(
      aliases
        .map((alias) => normalizeEmail(String(alias ?? '')))
        .filter((alias) => alias.length > 0 && alias !== canonicalEmail),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

export function validateAdminBudgetViewerMonthNumbers(monthNumbers: readonly number[]): number[] {
  const normalized = Array.from(
    new Set(
      monthNumbers
        .map((monthNumber) => Number.parseInt(String(monthNumber), 10))
        .filter((monthNumber) => Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12),
    ),
  ).sort((left, right) => left - right)

  if (normalized.length === 0) {
    throw new Error('Select at least one closed month for scoped budget viewers.')
  }

  return normalized
}

export function validateAdminAccessUserInput(input: AdminAccessUserInput): NormalizedAdminAccessUserInput {
  const sourceEmail = input.sourceEmail ? normalizeEmail(input.sourceEmail) : null
  const email = normalizeEmail(String(input.email ?? ''))
  if (!email) {
    throw new Error('A canonical email is required.')
  }
  if (!isOrcaEmail(email)) {
    throw new Error('Canonical email must be an @orca.so address.')
  }

  if (!isAccessRole(input.role)) {
    throw new Error('Role must be admin, budget_admin, or restricted.')
  }

  const aliases = normalizeAliasList(input.aliases ?? [], email)
  for (const alias of aliases) {
    if (!isOrcaEmail(alias)) {
      throw new Error(`Alias ${alias} must be an @orca.so address.`)
    }
  }

  const { departments, unknownDepartments } = normalizeDepartmentList(input.departments ?? [])
  if (unknownDepartments.length > 0) {
    throw new Error(`Unknown departments: ${unknownDepartments.join(', ')}`)
  }

  if (!usesDepartmentScopedBudgetAccess(input.role)) {
    return {
      sourceEmail,
      email,
      role: input.role,
      budgetDefaultDepartment: null,
      departments: [],
      aliases,
    }
  }

  if (departments.length === 0) {
    const roleLabel = input.role === 'budget_admin' ? 'Budget admins' : 'Restricted users'
    throw new Error(`${roleLabel} must be assigned at least one department.`)
  }

  const rawDefaultDepartment = String(input.budgetDefaultDepartment ?? '').trim()
  const budgetDefaultDepartment = rawDefaultDepartment
    ? normalizeBudgetDepartmentName(rawDefaultDepartment)
    : departments[0]

  if (!budgetDefaultDepartment) {
    throw new Error(`Unknown default department: ${rawDefaultDepartment}`)
  }

  if (!departments.includes(budgetDefaultDepartment)) {
    throw new Error('Default department must be one of the assigned departments.')
  }

  return {
    sourceEmail,
    email,
    role: input.role,
    budgetDefaultDepartment,
    departments,
    aliases,
  }
}

export function assertAdminAccessUserConflicts(
  input: NormalizedAdminAccessUserInput,
  users: readonly AdminAccessUserRecord[],
): void {
  const sourceEmail = input.sourceEmail ?? input.email
  const otherUsers = users.filter((user) => user.email !== sourceEmail)

  if (input.sourceEmail && input.sourceEmail !== input.email && users.some((user) => user.email === input.email)) {
    throw new Error(`A user with ${input.email} already exists.`)
  }

  const canonicalClaimedAsAlias = otherUsers.find((user) => user.aliases.includes(input.email))
  if (canonicalClaimedAsAlias) {
    throw new Error(`${input.email} is already configured as an alias for ${canonicalClaimedAsAlias.email}.`)
  }

  for (const alias of input.aliases) {
    const claimedAsCanonical = otherUsers.find((user) => user.email === alias)
    if (claimedAsCanonical) {
      throw new Error(`${alias} is already configured as a canonical email for ${claimedAsCanonical.email}.`)
    }

    const claimedAsAlias = otherUsers.find((user) => user.aliases.includes(alias))
    if (claimedAsAlias) {
      throw new Error(`${alias} is already configured as an alias for ${claimedAsAlias.email}.`)
    }
  }
}

export function assertAdminAccessAdminSafety(
  nextUser: NormalizedAdminAccessUserInput,
  users: readonly AdminAccessUserRecord[],
): void {
  const sourceEmail = nextUser.sourceEmail ?? nextUser.email
  const sourceUser = users.find((user) => user.email === sourceEmail)
  const adminCount = users.filter((user) => user.role === 'admin').length

  if (sourceUser?.role === 'admin' && nextUser.role !== 'admin' && adminCount <= 1) {
    throw new Error('At least one admin must remain configured.')
  }
}

export function assertAdminAccessDeleteSafety(
  email: string,
  users: readonly AdminAccessUserRecord[],
): void {
  const normalizedEmail = normalizeEmail(email)
  const targetUser = users.find((user) => user.email === normalizedEmail)
  const adminCount = users.filter((user) => user.role === 'admin').length

  if (targetUser?.role === 'admin' && adminCount <= 1) {
    throw new Error('You cannot remove the last configured admin.')
  }
}

export function prepareAdminAccessUserInput(
  input: AdminAccessUserInput,
  users: readonly AdminAccessUserRecord[],
): NormalizedAdminAccessUserInput {
  const normalized = validateAdminAccessUserInput(input)

  assertAdminAccessUserConflicts(normalized, users)
  assertAdminAccessAdminSafety(normalized, users)

  if (normalized.sourceEmail && normalized.sourceEmail !== normalized.email) {
    throw new Error('Changing a canonical email is not supported yet. Create the new user, then remove the old one.')
  }

  return normalized
}

export function getAdminAccessUserValidationError(
  input: AdminAccessUserInput,
  users: readonly AdminAccessUserRecord[],
): string | null {
  try {
    prepareAdminAccessUserInput(input, users)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid access configuration.'
  }
}
