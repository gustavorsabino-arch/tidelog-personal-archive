import 'server-only'

import { BUDGET_DEPTS } from './constants'
import { createAdminClient } from './supabase/admin'
import { normalizeEmail, type AccessRole } from './access-model'
import {
  assertAdminAccessDeleteSafety,
  prepareAdminAccessUserInput,
  validateAdminBudgetViewerMonthNumbers,
  type AdminAccessSnapshot,
  type AdminAccessUserInput,
  type AdminAccessUserRecord,
  type AdminBudgetViewerSettings,
} from './admin-access-model'
import { normalizeBudgetDepartmentName } from './budget/departments'
import type { BudgetDepartment } from './budget/types'

type AdminClient = ReturnType<typeof createAdminClient>

type UserAccessRow = {
  email: string
  role: AccessRole
  budget_department?: string | null
  budget_default_department?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type UserAccessDepartmentRow = {
  email: string
  department: string | null
}

type UserAccessAliasRow = {
  email: string
  alias_email: string | null
}

type BudgetAccessSettingsRow = {
  year: number
  viewer_months: number[] | null
}

const BUDGET_DEPARTMENT_INDEX = new Map(BUDGET_DEPTS.map((department, index) => [department, index]))

function normalizeViewerMonthNumbers(monthNumbers: number[] | null | undefined): number[] {
  return Array.from(
    new Set(
      (monthNumbers ?? [])
        .map((monthNumber) => Number.parseInt(String(monthNumber), 10))
        .filter((monthNumber) => Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12),
    ),
  ).sort((left, right) => left - right)
}

function sortBudgetDepartments(departments: readonly BudgetDepartment[]): BudgetDepartment[] {
  return [...departments].sort((left, right) => (
    (BUDGET_DEPARTMENT_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (BUDGET_DEPARTMENT_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER)
  ))
}

function buildAdminAccessUsers(
  accessRows: readonly UserAccessRow[],
  departmentRows: readonly UserAccessDepartmentRow[],
  aliasRows: readonly UserAccessAliasRow[],
): AdminAccessUserRecord[] {
  const departmentsByEmail = new Map<string, BudgetDepartment[]>()
  for (const row of departmentRows) {
    const email = normalizeEmail(row.email)
    const department = normalizeBudgetDepartmentName(row.department)
    if (!department) continue
    const current = departmentsByEmail.get(email) ?? []
    if (!current.includes(department)) {
      current.push(department)
      departmentsByEmail.set(email, sortBudgetDepartments(current))
    }
  }

  const aliasesByEmail = new Map<string, string[]>()
  for (const row of aliasRows) {
    const email = normalizeEmail(row.email)
    const alias = normalizeEmail(String(row.alias_email ?? ''))
    if (!alias) continue
    const current = aliasesByEmail.get(email) ?? []
    if (!current.includes(alias)) {
      current.push(alias)
      aliasesByEmail.set(email, current)
    }
  }

  return [...accessRows]
    .map((row) => {
      const email = normalizeEmail(row.email)
      const scopedDepartments = sortBudgetDepartments(departmentsByEmail.get(email) ?? [])
      const departments = row.role === 'restricted' ? scopedDepartments : []
      const fallbackDepartment = row.role === 'restricted'
        ? normalizeBudgetDepartmentName(row.budget_default_department ?? row.budget_department ?? null)
        : null
      const budgetDefaultDepartment = fallbackDepartment && departments.includes(fallbackDepartment)
        ? fallbackDepartment
        : (departments[0] ?? null)

      return {
        email,
        role: row.role,
        budgetDefaultDepartment,
        departments,
        aliases: (aliasesByEmail.get(email) ?? []).sort((left, right) => left.localeCompare(right)),
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
      } satisfies AdminAccessUserRecord
    })
    .sort((left, right) => left.email.localeCompare(right.email))
}

async function loadAccessRows(client: AdminClient): Promise<UserAccessRow[]> {
  const { data, error } = await client
    .from('user_access')
    .select('email, role, budget_department, budget_default_department, created_at, updated_at')
    .order('email', { ascending: true })

  if (error) {
    throw new Error(`Failed to load user access rows: ${error.message}`)
  }

  return (data ?? []) as UserAccessRow[]
}

async function loadDepartmentRows(client: AdminClient): Promise<UserAccessDepartmentRow[]> {
  const { data, error } = await client
    .from('user_access_departments')
    .select('email, department')

  if (error) {
    throw new Error(`Failed to load user access departments: ${error.message}`)
  }

  return (data ?? []) as UserAccessDepartmentRow[]
}

async function loadAliasRows(client: AdminClient): Promise<UserAccessAliasRow[]> {
  const { data, error } = await client
    .from('user_access_aliases')
    .select('email, alias_email')

  if (error) {
    throw new Error(`Failed to load user access aliases: ${error.message}`)
  }

  return (data ?? []) as UserAccessAliasRow[]
}

async function loadViewerSettings(client: AdminClient, year: number): Promise<AdminBudgetViewerSettings> {
  const { data, error } = await client
    .from('budget_access_settings')
    .select('year, viewer_months')
    .eq('year', year)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load budget access settings: ${error.message}`)
  }

  const settings = data as BudgetAccessSettingsRow | null
  return {
    year,
    viewerMonthNumbers: normalizeViewerMonthNumbers(settings?.viewer_months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  }
}

export async function loadAdminAccessSnapshot(year: number): Promise<AdminAccessSnapshot> {
  const client = createAdminClient()
  const [accessRows, departmentRows, aliasRows, viewerSettings] = await Promise.all([
    loadAccessRows(client),
    loadDepartmentRows(client),
    loadAliasRows(client),
    loadViewerSettings(client, year),
  ])

  return {
    users: buildAdminAccessUsers(accessRows, departmentRows, aliasRows),
    viewerSettings,
  }
}

export async function saveAdminAccessUser(input: AdminAccessUserInput): Promise<AdminAccessUserRecord> {
  const client = createAdminClient()
  const [accessRows, departmentRows, aliasRows] = await Promise.all([
    loadAccessRows(client),
    loadDepartmentRows(client),
    loadAliasRows(client),
  ])
  const users = buildAdminAccessUsers(accessRows, departmentRows, aliasRows)
  const normalized = prepareAdminAccessUserInput(input, users)

  const { error: upsertError } = await client
    .from('user_access')
    .upsert({
      email: normalized.email,
      role: normalized.role,
      budget_department: normalized.budgetDefaultDepartment,
      budget_default_department: normalized.budgetDefaultDepartment,
    }, { onConflict: 'email' })

  if (upsertError) {
    throw new Error(`Failed to save user access: ${upsertError.message}`)
  }

  const { error: deleteDepartmentsError } = await client
    .from('user_access_departments')
    .delete()
    .eq('email', normalized.email)

  if (deleteDepartmentsError) {
    throw new Error(`Failed to clear user access departments: ${deleteDepartmentsError.message}`)
  }

  if (normalized.departments.length > 0) {
    const { error: insertDepartmentsError } = await client
      .from('user_access_departments')
      .insert(normalized.departments.map((department) => ({
        email: normalized.email,
        department,
      })))

    if (insertDepartmentsError) {
      throw new Error(`Failed to save user access departments: ${insertDepartmentsError.message}`)
    }
  }

  const { error: deleteAliasesError } = await client
    .from('user_access_aliases')
    .delete()
    .eq('email', normalized.email)

  if (deleteAliasesError) {
    throw new Error(`Failed to clear user access aliases: ${deleteAliasesError.message}`)
  }

  if (normalized.aliases.length > 0) {
    const { error: insertAliasesError } = await client
      .from('user_access_aliases')
      .insert(normalized.aliases.map((aliasEmail) => ({
        email: normalized.email,
        alias_email: aliasEmail,
      })))

    if (insertAliasesError) {
      throw new Error(`Failed to save user access aliases: ${insertAliasesError.message}`)
    }
  }

  const nextSnapshot = await loadAdminAccessSnapshot(new Date().getFullYear())
  const savedUser = nextSnapshot.users.find((user) => user.email === normalized.email)
  if (!savedUser) {
    throw new Error('User access saved, but the saved record could not be reloaded.')
  }

  return savedUser
}

export async function deleteAdminAccessUser(email: string): Promise<void> {
  const client = createAdminClient()
  const normalizedEmail = normalizeEmail(email)
  const [accessRows, departmentRows, aliasRows] = await Promise.all([
    loadAccessRows(client),
    loadDepartmentRows(client),
    loadAliasRows(client),
  ])
  const users = buildAdminAccessUsers(accessRows, departmentRows, aliasRows)

  assertAdminAccessDeleteSafety(normalizedEmail, users)

  const { error } = await client
    .from('user_access')
    .delete()
    .eq('email', normalizedEmail)

  if (error) {
    throw new Error(`Failed to delete user access: ${error.message}`)
  }
}

export async function saveAdminBudgetViewerSettings(
  year: number,
  viewerMonthNumbers: readonly number[],
): Promise<AdminBudgetViewerSettings> {
  const client = createAdminClient()
  const normalizedViewerMonthNumbers = validateAdminBudgetViewerMonthNumbers(viewerMonthNumbers)

  const { error } = await client
    .from('budget_access_settings')
    .upsert({
      year,
      viewer_months: normalizedViewerMonthNumbers,
    }, { onConflict: 'year' })

  if (error) {
    throw new Error(`Failed to save budget access settings: ${error.message}`)
  }

  return loadViewerSettings(client, year)
}
