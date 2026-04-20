'use client'

import { BUDGET_ENTITIES } from '@/lib/constants'
import { getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { BUDGET_MONTH_LABELS, BUDGET_MONTH_SHORT_LABELS, getBudgetSelectableYears } from '@/lib/budget/scope'
import type { BudgetDepartmentViewScope, BudgetEntityScope, BudgetViewMode, BudgetViewState } from '@/lib/budget/types'

type BudgetScopeControlsProps = {
  year: number
  value: BudgetViewState
  department?: BudgetDepartmentViewScope | ''
  departments?: readonly BudgetDepartmentViewScope[]
  onChange: (next: BudgetViewState) => void
  onYearChange: (year: number) => void
  onDepartmentChange?: (department: BudgetDepartmentViewScope) => void
  showDepartmentSelector?: boolean
  onFetchActuals?: () => void
  isFetchingActuals?: boolean
  fetchButtonLabel?: string
  onOpenQbConnect?: () => void
  showQbConnect?: boolean
  qbStatusText?: string | null
  showEntitySelector?: boolean
  availableModes?: readonly BudgetViewMode[]
  availableMonthIndices?: readonly number[]
  allowedEntities?: readonly BudgetEntityScope[] | null
}

export function BudgetScopeControls({
  year,
  value,
  department = '',
  departments = [],
  onChange,
  onYearChange,
  onDepartmentChange,
  showDepartmentSelector = false,
  onFetchActuals,
  isFetchingActuals = false,
  fetchButtonLabel = 'Fetch Actuals from QB',
  onOpenQbConnect,
  showQbConnect = false,
  qbStatusText = null,
  showEntitySelector = true,
  availableModes = ['ytd', 'month', 'range'],
  availableMonthIndices,
  allowedEntities = null,
}: BudgetScopeControlsProps) {
  function update(patch: Partial<BudgetViewState>) {
    onChange({ ...value, ...patch })
  }

  const monthIndices = availableMonthIndices && availableMonthIndices.length > 0
    ? [...availableMonthIndices]
    : BUDGET_MONTH_LABELS.map((_, index) => index)
  const entityOptions: BudgetEntityScope[] = allowedEntities && allowedEntities.length > 0
    ? [...allowedEntities]
    : ['All', ...BUDGET_ENTITIES]
  const selectableYears = getBudgetSelectableYears()
  const entityLabel = (entity: BudgetEntityScope) => entity === 'All' ? 'All Entities' : entity
  const showModeSelector = availableModes.length > 1
  const effectiveMode = availableModes.includes(value.mode) ? value.mode : (availableModes[0] ?? 'ytd')

  return (
    <div className="budget-scope-toolbar">
      {showEntitySelector ? (
        <label className="budget-scope-inline-field">
          <span className="budget-scope-inline-label">Entity:</span>
          <select
            className="fsel"
            value={value.entity}
            onChange={(event) => update({ entity: event.target.value as BudgetViewState['entity'] })}
          >
            {entityOptions.map((entity) => (
              <option key={entity} value={entity}>{entityLabel(entity)}</option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="budget-scope-inline-field">
        <span className="budget-scope-inline-label">Year:</span>
        <select
          className="fsel"
          value={String(year)}
          onChange={(event) => onYearChange(Number.parseInt(event.target.value, 10))}
        >
          {selectableYears.map((optionYear) => (
            <option key={optionYear} value={optionYear}>{optionYear}</option>
          ))}
        </select>
      </label>

      <div className="budget-scope-mode-wrap">
        {showModeSelector ? (
          <label className="budget-scope-inline-field">
            <span className="budget-scope-inline-label">Mode:</span>
            <select
              className="fsel"
              value={effectiveMode}
              onChange={(event) => update({ mode: event.target.value as BudgetViewMode })}
            >
              {availableModes.includes('ytd') ? <option value="ytd">Year to Date</option> : null}
              {availableModes.includes('month') ? <option value="month">Single Month</option> : null}
              {availableModes.includes('range') ? <option value="range">Month Range</option> : null}
            </select>
          </label>
        ) : null}

        {effectiveMode === 'month' ? (
          <label className="budget-scope-inline-field">
            <span className="budget-scope-inline-label">Month:</span>
            <select
              className="fsel"
              value={String(value.month)}
              onChange={(event) => update({ month: Number.parseInt(event.target.value, 10) })}
            >
              {monthIndices.map((monthIndex) => (
                <option key={monthIndex} value={monthIndex}>{BUDGET_MONTH_LABELS[monthIndex]}</option>
              ))}
            </select>
          </label>
        ) : null}

        {effectiveMode === 'range' ? (
          <>
            <label className="budget-scope-inline-field">
              <span className="budget-scope-inline-label">From:</span>
              <select
                className="fsel"
                value={String(value.rangeStart)}
                onChange={(event) => update({ rangeStart: Number.parseInt(event.target.value, 10) })}
              >
                {monthIndices.map((monthIndex) => (
                  <option key={monthIndex} value={monthIndex}>{BUDGET_MONTH_SHORT_LABELS[monthIndex]}</option>
                ))}
              </select>
            </label>

            <label className="budget-scope-inline-field">
              <span className="budget-scope-inline-label">To:</span>
              <select
                className="fsel"
                value={String(value.rangeEnd)}
                onChange={(event) => update({ rangeEnd: Number.parseInt(event.target.value, 10) })}
              >
                {monthIndices.map((monthIndex) => (
                  <option key={monthIndex} value={monthIndex}>{BUDGET_MONTH_SHORT_LABELS[monthIndex]}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>

      {showDepartmentSelector && onDepartmentChange ? (
        <label className="budget-scope-inline-field">
          <span className="budget-scope-inline-label">Department:</span>
          <select
            className="fsel"
            value={department || departments[0] || ''}
            onChange={(event) => onDepartmentChange(event.target.value as BudgetDepartmentViewScope)}
          >
            {departments.map((valueDepartment) => (
              <option key={valueDepartment} value={valueDepartment}>
                {valueDepartment === 'All' ? 'All Departments' : getBudgetDepartmentLabel(valueDepartment)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="budget-qb-controls">
        {showQbConnect && onOpenQbConnect ? (
          <button
            className="btn-secondary budget-qb-connect-btn"
            type="button"
            onClick={onOpenQbConnect}
          >
            Connect QB
          </button>
        ) : null}

        <button
          className="btn-secondary budget-qb-placeholder-btn"
          type="button"
          disabled={!onFetchActuals || isFetchingActuals}
          onClick={() => onFetchActuals?.()}
        >
          {isFetchingActuals ? '⏳ Fetching…' : `↺ ${fetchButtonLabel}`}
        </button>

        {qbStatusText ? <span className="budget-qb-inline-status">{qbStatusText}</span> : null}
      </div>
    </div>
  )
}
