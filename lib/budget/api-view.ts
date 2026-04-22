import { clampBudgetViewState, getDefaultBudgetViewState, normalizeBudgetYear } from './scope.ts'
import { BUDGET_ENTITIES } from '../constants.ts'
import type { BudgetEntityScope, BudgetViewMode, BudgetViewState } from './types.ts'

type BudgetViewParseRestrictions = {
  allowedMonthIndices?: readonly number[] | null
  allowedModes?: readonly BudgetViewMode[] | null
  allowedEntities?: readonly BudgetEntityScope[] | null
}

export function parseBudgetViewFromSearchParams(
  searchParams: URLSearchParams,
  restrictions: BudgetViewParseRestrictions = {},
): BudgetViewState {
  const requestedYear = Number.parseInt(searchParams.get('year') ?? '2026', 10)
  const defaultView = getDefaultBudgetViewState(
    normalizeBudgetYear(Number.isFinite(requestedYear) ? requestedYear : 2026),
    restrictions,
  )
  const year = Number.parseInt(searchParams.get('year') ?? String(defaultView.year), 10)
  const rawEntity = searchParams.get('entity') ?? defaultView.entity
  const entity = (rawEntity === 'All' || BUDGET_ENTITIES.includes(rawEntity as typeof BUDGET_ENTITIES[number])
    ? rawEntity
    : defaultView.entity) as BudgetEntityScope
  const rawMode = searchParams.get('mode') ?? defaultView.mode
  const mode = (rawMode === 'ytd' || rawMode === 'month' || rawMode === 'range'
    ? rawMode
    : rawMode === 'annual'
      ? 'ytd'
      : defaultView.mode) as BudgetViewState['mode']
  const month = Number.parseInt(searchParams.get('month') ?? String(defaultView.month), 10)
  const rangeStart = Number.parseInt(searchParams.get('rangeStart') ?? String(defaultView.rangeStart), 10)
  const rangeEnd = Number.parseInt(searchParams.get('rangeEnd') ?? String(defaultView.rangeEnd), 10)

  return clampBudgetViewState({
    year: Number.isFinite(year) ? year : defaultView.year,
    entity,
    mode,
    month: Number.isFinite(month) ? month : defaultView.month,
    rangeStart: Number.isFinite(rangeStart) ? rangeStart : defaultView.rangeStart,
    rangeEnd: Number.isFinite(rangeEnd) ? rangeEnd : defaultView.rangeEnd,
  }, restrictions)
}
