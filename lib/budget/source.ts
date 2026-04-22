import { and, eq, inArray } from 'drizzle-orm'

import { db } from '@/lib/db'
import { budgetLine } from '@/lib/db/schema/budget'
import { BUDGET_DEPTS } from '../constants.ts'
import { normalizeBudgetLineAmounts } from './catalog.ts'
import { loadBudgetTeamState as loadBudgetTeamStateFromDb, getBudgetTeamPlaceholderState } from './team.ts'
import type {
  BudgetDepartment,
  BudgetDepartmentPlan,
  BudgetLineAmounts,
  BudgetPeriodKey,
  BudgetPlanState,
  BudgetState,
  BudgetTeamState,
} from './types.ts'

const BUDGET_MONTH_PERIOD_KEYS: BudgetPeriodKey[] = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
]

function isBudgetPeriodKey(value: string): value is BudgetPeriodKey {
  return value === 'annual' || BUDGET_MONTH_PERIOD_KEYS.includes(value as BudgetPeriodKey)
}

const PLACEHOLDER_BUDGET_YEAR = 2026

function emptyDepartmentPlan(year: number, department: BudgetDepartment): BudgetDepartmentPlan {
  return {
    version: 1,
    year,
    department,
    periods: {},
    source: 'placeholder-static',
    importMeta: null,
  }
}

/**
 * Synchronous empty-state scaffold. Used by pure-logic tests and by callers
 * that want a valid BudgetPlanState shape before loading real data.
 */
export function getBudgetPlanState(): BudgetPlanState {
  const departments = Object.fromEntries(
    BUDGET_DEPTS.map((department) => [department, emptyDepartmentPlan(PLACEHOLDER_BUDGET_YEAR, department)]),
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

function isBudgetDepartment(value: string): value is BudgetDepartment {
  return (BUDGET_DEPTS as readonly string[]).includes(value)
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

/**
 * Kept for backwards compatibility with legacy tests; in the Drizzle world the
 * department list comes from the DB query and this helper is a no-op filter.
 */
export function getBudgetDepartmentsToRead(
  _year: number,
  requestedDepartments: readonly BudgetDepartment[] | null | undefined,
  availablePlanFiles: readonly string[],
): BudgetDepartment[] {
  const requested = normalizeRequestedBudgetDepartments(requestedDepartments)
  if (availablePlanFiles.length === 0) return []
  const availableDepartments = new Set(
    availablePlanFiles
      .map((name) => name.replace(/\.json$/i, ''))
      .map((name) => BUDGET_DEPTS.find((d) => d.toLowerCase() === name.toLowerCase()))
      .filter((d): d is BudgetDepartment => Boolean(d)),
  )
  return requested.filter((d) => availableDepartments.has(d))
}

export async function loadBudgetPlanState(
  year: number,
  _noCache = false,
  requestedDepartments: readonly BudgetDepartment[] | null = null,
): Promise<BudgetPlanState> {
  const allowedDepartments = normalizeRequestedBudgetDepartments(requestedDepartments)
  const rows = allowedDepartments.length === BUDGET_DEPTS.length
    ? await db.select().from(budgetLine).where(eq(budgetLine.year, year))
    : allowedDepartments.length === 0
      ? []
      : await db
          .select()
          .from(budgetLine)
          .where(and(eq(budgetLine.year, year), inArray(budgetLine.department, allowedDepartments)))

  // department → period → { lineItem: amount }
  const grouped = new Map<BudgetDepartment, Partial<Record<BudgetPeriodKey, BudgetLineAmounts>>>()
  let mostRecentUpdatedAt: string | null = null

  for (const row of rows) {
    if (!isBudgetDepartment(row.department)) continue
    if (!isBudgetPeriodKey(row.period)) continue
    const perDept = grouped.get(row.department) ?? {}
    const amounts = perDept[row.period] ?? {}
    amounts[row.lineItem] = Number(row.amount)
    perDept[row.period] = amounts
    grouped.set(row.department, perDept)
    const updatedAtIso = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
    if (updatedAtIso && (!mostRecentUpdatedAt || updatedAtIso > mostRecentUpdatedAt)) {
      mostRecentUpdatedAt = updatedAtIso
    }
  }

  const departments = Object.fromEntries(
    BUDGET_DEPTS.map((department) => {
      const perPeriod = grouped.get(department)
      if (!perPeriod) return [department, emptyDepartmentPlan(year, department)]
      const normalizedPeriods: Partial<Record<BudgetPeriodKey, BudgetLineAmounts>> = {}
      for (const [period, amounts] of Object.entries(perPeriod) as Array<[BudgetPeriodKey, BudgetLineAmounts]>) {
        normalizedPeriods[period] = normalizeBudgetLineAmounts(amounts)
      }
      const plan: BudgetDepartmentPlan = {
        version: 1,
        year,
        department,
        periods: normalizedPeriods,
        source: 'sheet-import',
        importMeta: null,
      }
      return [department, plan]
    }),
  ) as Record<BudgetDepartment, BudgetDepartmentPlan>

  return {
    version: 1,
    year,
    departments,
    source: rows.length > 0 ? 'sheet-import' : 'placeholder-static',
    lastUpdatedAt: mostRecentUpdatedAt,
  }
}

export async function loadBudgetTeamState(year: number, noCache = false): Promise<BudgetTeamState> {
  return loadBudgetTeamStateFromDb(year, noCache)
}

function sumMonthlyPeriods(plan: BudgetDepartmentPlan): BudgetLineAmounts {
  const totals: BudgetLineAmounts = {}
  for (const [period, lines] of Object.entries(plan.periods)) {
    if (period === 'annual' || !lines) continue
    for (const [key, value] of Object.entries(normalizeBudgetLineAmounts(lines))) {
      totals[key] = (totals[key] ?? 0) + (value ?? 0)
    }
  }
  return totals
}

/**
 * Replace every budget_line row for (year, department) with one row per
 * (period, lineItem) from the provided plan. An `annual` period is always
 * written — either the plan's own annual totals, or the sum of the plan's
 * monthly periods when no explicit annual was provided.
 */
export async function saveBudgetDepartmentPlan(plan: BudgetDepartmentPlan): Promise<void> {
  const explicitAnnual = plan.periods.annual
  const hasExplicitAnnual = explicitAnnual && Object.keys(explicitAnnual).length > 0
  const derivedAnnual = hasExplicitAnnual
    ? normalizeBudgetLineAmounts(explicitAnnual)
    : sumMonthlyPeriods(plan)

  const now = new Date()
  const values: Array<typeof budgetLine.$inferInsert> = []

  for (const [lineItem, amount] of Object.entries(derivedAnnual)) {
    if (!amount) continue
    values.push({
      year: plan.year,
      department: plan.department,
      period: 'annual',
      lineItem,
      amount: String(amount),
      updatedAt: now,
    })
  }

  for (const [period, lines] of Object.entries(plan.periods)) {
    if (period === 'annual' || !lines) continue
    const normalized = normalizeBudgetLineAmounts(lines)
    for (const [lineItem, amount] of Object.entries(normalized)) {
      if (!amount) continue
      values.push({
        year: plan.year,
        department: plan.department,
        period,
        lineItem,
        amount: String(amount),
        updatedAt: now,
      })
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(budgetLine)
      .where(and(eq(budgetLine.year, plan.year), eq(budgetLine.department, plan.department)))
    if (values.length > 0) {
      await tx.insert(budgetLine).values(values)
    }
  })
}

/**
 * Delete all budget_line rows for (year, department). Returns the number of
 * rows removed.
 */
export async function deleteBudgetDepartmentPlan(year: number, department: BudgetDepartment): Promise<number> {
  const result = await db
    .delete(budgetLine)
    .where(and(eq(budgetLine.year, year), eq(budgetLine.department, department)))
    .returning({ lineItem: budgetLine.lineItem })
  return result.length
}

export async function loadBudgetDepartmentPlan(
  year: number,
  department: BudgetDepartment,
): Promise<BudgetDepartmentPlan | null> {
  const state = await loadBudgetPlanState(year, true, [department])
  const plan = state.departments[department]
  if (!plan) return null
  if (Object.keys(plan.periods).length === 0) return null
  return plan
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

  return { plan, team }
}
