import type { BudgetMonthKey, BudgetPeriodKey, BudgetViewState } from './types.ts'
import type { BudgetEntityScope, BudgetViewMode } from './types.ts'

export const MIN_BUDGET_YEAR = 2026
export const BUDGET_MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export const BUDGET_MONTH_SHORT_LABELS = BUDGET_MONTH_LABELS.map((label) => label.slice(0, 3))

type BudgetViewRestrictions = {
  allowedMonthIndices?: readonly number[] | null
  allowedModes?: readonly BudgetViewMode[] | null
  allowedEntities?: readonly BudgetEntityScope[] | null
}

const ALL_BUDGET_MONTH_INDICES = BUDGET_MONTH_LABELS.map((_, index) => index)
const ALL_BUDGET_VIEW_MODES: BudgetViewMode[] = ['ytd', 'month', 'range']

export function normalizeBudgetYear(year: number): number {
  if (!Number.isFinite(year)) return MIN_BUDGET_YEAR
  return Math.max(MIN_BUDGET_YEAR, Math.trunc(year))
}

export function getBudgetSelectableYears(currentYear = new Date().getFullYear()): number[] {
  const endYear = Math.max(MIN_BUDGET_YEAR + 1, normalizeBudgetYear(currentYear) + 1)
  return Array.from({ length: endYear - MIN_BUDGET_YEAR + 1 }, (_, index) => MIN_BUDGET_YEAR + index)
}

function normalizeMonthIndices(monthIndices: readonly number[] | null | undefined): number[] {
  if (!monthIndices || monthIndices.length === 0) {
    return [...ALL_BUDGET_MONTH_INDICES]
  }

  const normalized = Array.from(
    new Set(
      monthIndices.filter((monthIndex) => Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11),
    ),
  ).sort((left, right) => left - right)

  return normalized.length > 0 ? normalized : [...ALL_BUDGET_MONTH_INDICES]
}

function normalizeModes(modes: readonly BudgetViewMode[] | null | undefined): BudgetViewMode[] {
  if (!modes || modes.length === 0) {
    return [...ALL_BUDGET_VIEW_MODES]
  }

  const normalized = Array.from(
    new Set(modes.filter((mode) => ALL_BUDGET_VIEW_MODES.includes(mode))),
  )

  return normalized.length > 0 ? normalized : [...ALL_BUDGET_VIEW_MODES]
}

function normalizeEntities(entities: readonly BudgetEntityScope[] | null | undefined): BudgetEntityScope[] | null {
  if (!entities || entities.length === 0) return null
  return Array.from(new Set(entities))
}

function clampMonthIndexToAllowed(monthIndex: number, allowedMonthIndices: readonly number[]): number {
  if (allowedMonthIndices.includes(monthIndex)) return monthIndex

  const lastAllowedMonth = allowedMonthIndices.at(-1) ?? 0
  if (monthIndex > lastAllowedMonth) return lastAllowedMonth

  for (const allowedMonth of allowedMonthIndices) {
    if (allowedMonth >= monthIndex) return allowedMonth
  }

  return allowedMonthIndices[0] ?? 0
}

export function clampBudgetViewState(
  view: BudgetViewState,
  restrictions: BudgetViewRestrictions = {},
): BudgetViewState {
  const allowedMonthIndices = normalizeMonthIndices(restrictions.allowedMonthIndices)
  const allowedModes = normalizeModes(restrictions.allowedModes)
  const allowedEntities = normalizeEntities(restrictions.allowedEntities)
  const defaultMonth = clampMonthIndexToAllowed(new Date().getMonth(), allowedMonthIndices)
  const mode = allowedModes.includes(view.mode) ? view.mode : allowedModes[0] ?? 'ytd'
  const month = clampMonthIndexToAllowed(view.month, allowedMonthIndices)
  const rangeStart = clampMonthIndexToAllowed(view.rangeStart, allowedMonthIndices)
  const rangeEnd = clampMonthIndexToAllowed(view.rangeEnd, allowedMonthIndices)

  return {
    year: normalizeBudgetYear(view.year),
    entity: allowedEntities?.includes(view.entity) ? view.entity : (allowedEntities?.[0] ?? view.entity),
    mode,
    month: Number.isFinite(month) ? month : defaultMonth,
    rangeStart: Number.isFinite(rangeStart) ? rangeStart : allowedMonthIndices[0] ?? 0,
    rangeEnd: Number.isFinite(rangeEnd) ? rangeEnd : allowedMonthIndices.at(-1) ?? 0,
  }
}

export function getDefaultBudgetViewState(
  year = 2026,
  restrictions: BudgetViewRestrictions = {},
): BudgetViewState {
  const normalizedYear = normalizeBudgetYear(year)
  const currentMonth = Math.min(Math.max(new Date().getMonth(), 0), 11)
  return clampBudgetViewState({
    year: normalizedYear,
    entity: 'All',
    mode: 'ytd',
    month: currentMonth,
    rangeStart: 0,
    rangeEnd: currentMonth,
  }, restrictions)
}

export function monthIndexToPeriodKey(index: number): BudgetMonthKey {
  return String(index + 1).padStart(2, '0') as BudgetMonthKey
}

export function monthIndexToShortLabel(index: number): string {
  return BUDGET_MONTH_SHORT_LABELS[index] ?? `M${index + 1}`
}

export function monthIndexToLabel(index: number): string {
  return BUDGET_MONTH_LABELS[index] ?? `Month ${index + 1}`
}

export function getBudgetScopeMonthIndices(view: BudgetViewState): number[] {
  if (view.mode === 'ytd') return [Math.min(Math.max(view.month, 0), 11)]
  if (view.mode === 'month') return [Math.min(Math.max(view.month, 0), 11)]

  const start = Math.min(view.rangeStart, view.rangeEnd)
  const end = Math.max(view.rangeStart, view.rangeEnd)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

export function getBudgetScopeEndMonth(view: BudgetViewState): number {
  const indices = getBudgetScopeMonthIndices(view)
  return indices.at(-1) ?? 11
}

export function getBudgetScopeYtdMonthIndices(view: BudgetViewState): number[] {
  const endMonth = getBudgetScopeEndMonth(view)
  return Array.from({ length: endMonth + 1 }, (_, index) => index)
}

export function getBudgetScopePeriodLabel(view: BudgetViewState): string {
  if (view.mode === 'ytd') return monthIndexToShortLabel(view.month)
  if (view.mode === 'month') return monthIndexToShortLabel(view.month)
  return `${monthIndexToShortLabel(Math.min(view.rangeStart, view.rangeEnd))}-${monthIndexToShortLabel(Math.max(view.rangeStart, view.rangeEnd))}`
}

export function getBudgetScopeYtdLabel(view: BudgetViewState): string {
  return `${monthIndexToShortLabel(getBudgetScopeEndMonth(view))} YTD`
}

export function getBudgetPeriodKeyListForMonths(months: number[]): BudgetPeriodKey[] {
  return months.map(monthIndexToPeriodKey)
}
