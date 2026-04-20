import rawBudgetLines from '../../data/budget-lines.json' with { type: 'json' }
import { BUDGET_DEPTS } from '../constants.ts'
import { listDataFilesStrict, readDataFileStrict } from '../github.ts'
import { normalizeBudgetLineAmounts } from './catalog.ts'
import { getBudgetDepartmentPlanPath } from './import.ts'
import {
  getBudgetTeamFilePath,
  getBudgetTeamPlaceholderState,
  normalizeBudgetTeamState,
} from './team.ts'
import type {
  BudgetDepartment,
  BudgetDepartmentPlan,
  BudgetLineAmounts,
  BudgetPlanState,
  BudgetState,
  BudgetTeamState,
} from './types.ts'

const PLACEHOLDER_BUDGET_YEAR = 2026

function normalizeDepartmentPlan(department: BudgetDepartment): BudgetDepartmentPlan {
  const annualLines = normalizeBudgetLineAmounts((rawBudgetLines[department] ?? {}) as BudgetLineAmounts)
  return {
    version: 1,
    year: PLACEHOLDER_BUDGET_YEAR,
    department,
    periods: {
      annual: annualLines,
    },
    source: 'placeholder-static',
    importMeta: null,
  }
}

function normalizeLoadedDepartmentPlan(
  department: BudgetDepartment,
  year: number,
  plan: BudgetDepartmentPlan,
): BudgetDepartmentPlan {
  const normalizedPeriods = Object.fromEntries(
    Object.entries(plan.periods ?? {}).map(([period, lines]) => [
      period,
      normalizeBudgetLineAmounts((lines ?? {}) as BudgetLineAmounts),
    ]),
  ) as BudgetDepartmentPlan['periods']

  return {
    ...plan,
    version: 1,
    year,
    department,
    periods: normalizedPeriods,
  }
}

export function getBudgetPlanState(): BudgetPlanState {
  const departments = Object.fromEntries(
    BUDGET_DEPTS.map((department) => [department, normalizeDepartmentPlan(department)]),
  ) as Record<BudgetDepartment, BudgetDepartmentPlan>

  return {
    version: 1,
    year: PLACEHOLDER_BUDGET_YEAR,
    departments,
    source: 'placeholder-static',
    lastUpdatedAt: null,
  }
}

export function getBudgetTeamState(year = PLACEHOLDER_BUDGET_YEAR): BudgetTeamState {
  return getBudgetTeamPlaceholderState(year)
}

export function getBudgetState(): BudgetState {
  return {
    plan: getBudgetPlanState(),
    team: getBudgetTeamState(),
  }
}

function normalizeRequestedBudgetDepartments(
  departments: readonly BudgetDepartment[] | null | undefined,
): BudgetDepartment[] {
  if (!departments || departments.length === 0) {
    return [...BUDGET_DEPTS]
  }

  const requested = new Set(departments)
  return BUDGET_DEPTS.filter((department) => requested.has(department))
}

function getBudgetPlanPlaceholderForYear(year: number, department: BudgetDepartment): BudgetDepartmentPlan {
  return { ...normalizeDepartmentPlan(department), year }
}

function getBudgetDepartmentPlanFileName(year: number, department: BudgetDepartment): string {
  return getBudgetDepartmentPlanPath(year, department).split('/').at(-1) ?? `${department}.json`
}

export function getBudgetDepartmentsToRead(
  year: number,
  requestedDepartments: readonly BudgetDepartment[] | null | undefined,
  availablePlanFiles: readonly string[],
): BudgetDepartment[] {
  const availablePlanFileSet = new Set(availablePlanFiles)

  return normalizeRequestedBudgetDepartments(requestedDepartments)
    .filter((department) => availablePlanFileSet.has(getBudgetDepartmentPlanFileName(year, department)))
}

export async function loadBudgetPlanState(
  year: number,
  noCache = false,
  requestedDepartments: readonly BudgetDepartment[] | null = null,
): Promise<BudgetPlanState> {
  const placeholder = getBudgetPlanState()
  const requestedPlanDepartments = normalizeRequestedBudgetDepartments(requestedDepartments)
  const dirResult = await listDataFilesStrict(`budget/${year}/plan`, noCache)
  const hasImportedPlanFiles = dirResult.ok && dirResult.found && dirResult.files.length > 0

  if (!hasImportedPlanFiles) {
    return {
      ...placeholder,
      year,
      departments: Object.fromEntries(
        BUDGET_DEPTS.map((department) => [
          department,
          getBudgetPlanPlaceholderForYear(year, department),
        ]),
      ) as Record<BudgetDepartment, BudgetDepartmentPlan>,
    }
  }

  const departmentsToRead = getBudgetDepartmentsToRead(year, requestedPlanDepartments, dirResult.files)

  const loadedPlans = await Promise.all(
    departmentsToRead.map(async (department) => {
      const result = await readDataFileStrict<BudgetDepartmentPlan>(
        getBudgetDepartmentPlanPath(year, department),
        noCache,
      )
      if (!result.ok || !result.found) {
        return [department, getBudgetPlanPlaceholderForYear(year, department)] as const
      }
      return [department, normalizeLoadedDepartmentPlan(department, year, result.data)] as const
    }),
  )

  const loadedPlansByDepartment = new Map<BudgetDepartment, BudgetDepartmentPlan>(loadedPlans)
  const departments = Object.fromEntries(
    BUDGET_DEPTS.map((department) => [
      department,
      loadedPlansByDepartment.get(department) ?? getBudgetPlanPlaceholderForYear(year, department),
    ]),
  ) as Record<BudgetDepartment, BudgetDepartmentPlan>
  const importedPlans = Object.values(departments).filter((plan) => plan.source === 'sheet-import')
  const lastUpdatedAt = importedPlans
    .map((plan) => plan.importMeta?.lastImportedAt ?? null)
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1) ?? null

  return {
    version: 1,
    year,
    departments,
    source: hasImportedPlanFiles ? 'sheet-import' : 'placeholder-static',
    lastUpdatedAt,
  }
}

export async function loadBudgetTeamState(year: number, noCache = false): Promise<BudgetTeamState> {
  const result = await readDataFileStrict<BudgetTeamState>(getBudgetTeamFilePath(year), noCache)
  if (!result.ok || !result.found) {
    return getBudgetTeamPlaceholderState(year)
  }

  try {
    return normalizeBudgetTeamState(result.data, year)
  } catch (error) {
    console.error('[Budget] Failed to normalize managed team file, falling back to placeholder data:', error)
    return getBudgetTeamPlaceholderState(year)
  }
}

export async function loadBudgetState(
  year: number,
  noCache = false,
  options: {
    planDepartments?: readonly BudgetDepartment[] | null
  } = {},
): Promise<BudgetState> {
  const [plan, team] = await Promise.all([
    loadBudgetPlanState(year, noCache, options.planDepartments ?? null),
    loadBudgetTeamState(year, noCache),
  ])

  return {
    plan,
    team,
  }
}
