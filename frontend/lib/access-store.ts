import type { AccessRow, LoadedAccessConfig } from './access-model.ts'
import { normalizeEmail } from './access-model.ts'

type AccessLookupClient = {
  from: (table: string) => any
}

type AccessQueryClient = AccessLookupClient

type AccessLookupOptions = {
  year?: number | null
}

type ResolvedAccessLookupInput = {
  authEmail: string
  directRow: AccessRow | null
  aliasCanonicalEmail: string | null
  canonicalRow: AccessRow | null
  budgetDepartments: string[]
  budgetMonthIndices: number[] | null
}

function normalizeMonthNumbersToIndices(monthNumbers: unknown): number[] | null {
  if (!Array.isArray(monthNumbers)) return null

  const normalized = Array.from(
    new Set(
      monthNumbers
        .map((monthNumber) => Number.parseInt(String(monthNumber), 10) - 1)
        .filter((monthIndex) => Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11),
    ),
  ).sort((left, right) => left - right)

  return normalized.length > 0 ? normalized : null
}

async function maybeSelectSingle(
  client: AccessLookupClient,
  table: string,
  columns: string,
  column: string,
  value: string | number,
) {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq(column, value)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load ${table} for ${value}: ${error.message}`)
  }

  return data
}

async function selectMany(
  client: AccessLookupClient,
  table: string,
  columns: string,
  column: string,
  value: string,
) {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq(column, value)

  if (error) {
    throw new Error(`Failed to load ${table} for ${value}: ${error.message}`)
  }

  return data
}

async function loadAccessRow(
  client: AccessLookupClient,
  email: string,
): Promise<AccessRow | null> {
  const data = await maybeSelectSingle(
    client,
    'user_access',
    'email, role, budget_department, budget_default_department',
    'email',
    email,
  )

  return data
}

async function loadCanonicalEmail(
  client: AccessLookupClient,
  email: string,
): Promise<string | null> {
  const alias = await maybeSelectSingle(
    client,
    'user_access_aliases',
    'email',
    'alias_email',
    email,
  )

  return alias?.email ? normalizeEmail(alias.email) : null
}

async function loadBudgetDepartments(
  client: AccessLookupClient,
  email: string,
): Promise<string[]> {
  const data = await selectMany(client, 'user_access_departments', 'department', 'email', email)

  if (!Array.isArray(data)) return []
  return data
    .map((row: { department?: string | null }) => row.department?.trim())
    .filter((department: string | undefined): department is string => Boolean(department))
}

async function loadBudgetMonthIndices(
  client: AccessLookupClient,
  year: number | null | undefined,
): Promise<number[] | null> {
  if (!Number.isFinite(year)) return null

  const settings = await maybeSelectSingle(
    client,
    'budget_access_settings',
    'viewer_months',
    'year',
    year!,
  )

  return normalizeMonthNumbersToIndices(settings?.viewer_months ?? null)
}

export function resolveLoadedAccessConfigFromLookup(
  input: ResolvedAccessLookupInput,
): LoadedAccessConfig | null {
  const normalizedAuthEmail = normalizeEmail(input.authEmail)
  const normalizedAliasCanonicalEmail = input.aliasCanonicalEmail
    ? normalizeEmail(input.aliasCanonicalEmail)
    : null

  if (normalizedAliasCanonicalEmail) {
    if (!input.canonicalRow) {
      throw new Error(
        `Access configuration conflict: ${normalizedAuthEmail} is configured as an alias for ${normalizedAliasCanonicalEmail}, but no canonical access row exists for that email.`,
      )
    }

    return {
      row: input.canonicalRow,
      canonicalEmail: normalizeEmail(input.canonicalRow.email),
      budgetDepartments: input.budgetDepartments,
      budgetMonthIndices: input.budgetMonthIndices,
    }
  }

  if (!input.directRow) {
    return {
      row: null,
      canonicalEmail: normalizedAuthEmail,
      budgetDepartments: [],
      budgetMonthIndices: null,
    }
  }

  return {
    row: input.directRow,
    canonicalEmail: normalizeEmail(input.directRow.email),
    budgetDepartments: input.budgetDepartments,
    budgetMonthIndices: input.budgetMonthIndices,
  }
}

export async function loadAccessConfigByEmailWithClient(
  client: AccessQueryClient,
  email: string,
  options: AccessLookupOptions = {},
): Promise<LoadedAccessConfig | null> {
  const normalizedEmail = normalizeEmail(email)

  const [directRow, aliasCanonicalEmail] = await Promise.all([
    loadAccessRow(client, normalizedEmail),
    loadCanonicalEmail(client, normalizedEmail),
  ])

  const canonicalRow = aliasCanonicalEmail
    ? (
      aliasCanonicalEmail === normalizedEmail
        ? directRow
        : await loadAccessRow(client, aliasCanonicalEmail)
    )
    : directRow

  const canonicalEmail = aliasCanonicalEmail
    ?? (canonicalRow?.email ? normalizeEmail(canonicalRow.email) : normalizedEmail)
  const budgetDepartments = canonicalRow
    ? await loadBudgetDepartments(client, canonicalEmail)
    : []

  const fallbackDepartment = canonicalRow?.budget_department?.trim()
  if (budgetDepartments.length === 0 && fallbackDepartment) {
    budgetDepartments.push(fallbackDepartment)
  }

  return resolveLoadedAccessConfigFromLookup({
    authEmail: normalizedEmail,
    directRow,
    aliasCanonicalEmail,
    canonicalRow,
    budgetDepartments,
    budgetMonthIndices: canonicalRow?.role === 'restricted' || canonicalRow?.role === 'budget_admin'
      ? await loadBudgetMonthIndices(client, options.year ?? null)
      : null,
  })
}
