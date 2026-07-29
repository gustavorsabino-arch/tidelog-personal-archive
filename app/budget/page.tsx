'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { fmtUSD } from '@/lib/format'
import { BUDGET_DEPTS, ENTITIES } from '@/lib/constants'
import { apiFetch, apiPost } from '@/lib/api'
import { Skeleton } from '@/components/skeleton'

// Modals are opened rarely — defer their JS until the user actually triggers
// them so the initial /budget bundle isn't bloated by their dependencies.
const BudgetImportModal = dynamic(
  () => import('@/components/budget-import-modal').then((m) => m.BudgetImportModal),
)
const BudgetRecoveryModal = dynamic(
  () => import('@/components/budget-recovery-modal').then((m) => m.BudgetRecoveryModal),
)
const BudgetTeamMemberModal = dynamic(
  () => import('@/components/budget-team-member-modal').then((m) => m.BudgetTeamMemberModal),
)
const BudgetQbConnectModal = dynamic(
  () => import('@/components/budget-qb-connect-modal').then((m) => m.BudgetQbConnectModal),
)
const BudgetHeadcountModal = dynamic(
  () => import('@/components/budget-headcount-modal').then((m) => m.BudgetHeadcountModal),
)
const BudgetPlanBreakdownModal = dynamic(
  () => import('@/components/budget-plan-breakdown-modal').then((m) => m.BudgetPlanBreakdownModal),
)
const BudgetActualDrillModal = dynamic(
  () => import('@/components/budget-actual-drill-modal').then((m) => m.BudgetActualDrillModal),
)
const BudgetRevenueMonthlyModal = dynamic(
  () => import('@/components/budget-revenue-monthly-modal').then((m) => m.BudgetRevenueMonthlyModal),
)
import { BudgetScopeControls } from '@/components/budget-scope-controls'
import { BudgetReportTable } from '@/components/budget-report-table'
import { BudgetQbMappingPanel } from '@/components/budget-qb-mapping-panel'
import { BudgetCoveragePanel } from '@/components/budget-coverage-panel'
import { useSharedAccess } from '@/lib/access-context'
import type { BudgetBootstrapResponse } from '@/lib/budget/bootstrap'
import type {
  BudgetActualDrillState,
  BudgetCoverageState,
  BudgetDepartment,
  BudgetDepartmentActualScope,
  BudgetDepartmentActualsState,
  BudgetHeadcountActualsState,
  BudgetDepartmentViewScope,
  BudgetOverviewActualsState,
  BudgetQbMappingMutationResult,
  BudgetQbMappingRow,
  BudgetQbMappingState,
  BudgetPlanBreakdownState,
  BudgetReportColumnKey,
  BudgetReportRow,
  BudgetRevenueMonthlyBreakdown,
  BudgetState,
  BudgetTeamMember,
  BudgetTeamMutationResult,
  BudgetTeamState,
  BudgetViewState,
} from '@/lib/budget/types'
import type { QboStatusResponse, QboConnectionStatus } from '@/lib/qb/types'
import {
  canViewBudgetOverviewAllDepartments,
  getAllowedBudgetEntities,
  getAllowedBudgetViewModes,
  getDefaultBudgetDepartment,
  getVisibleBudgetTabs,
  hasBudgetPageAccess,
} from '@/lib/access-model'
import { getClosedBudgetMonthIndices } from '@/lib/budget/scope'
import {
  filterBudgetTeam,
  getBudgetHeadcountSummary,
  getBudgetTeamSummary,
  getHeadcountByDepartment,
  sortBudgetTeam,
  type BudgetTeamSortKey,
} from '@/lib/budget/selectors'
import {
  canFetchBudgetActuals,
  getMissingQboEntities,
} from '@/lib/budget/qb-status'
import { formatBudgetDepartmentList, getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { getBudgetActualRequest } from '@/lib/budget/actual-request'
import {
  canOpenBudgetActualDrill,
  canOpenBudgetPlanBreakdown,
  getBudgetActualDrillTitle,
} from '@/lib/budget/drill'
import {
  clampBudgetViewState,
  getBudgetScopePeriodLabel,
  getBudgetScopeYtdLabel,
  getDefaultBudgetViewState,
  normalizeBudgetYear,
} from '@/lib/budget/scope'
import {
  applyBudgetDepartmentActuals,
  applyBudgetOverviewActuals,
  buildBudgetPlanBreakdown,
  buildBudgetDepartmentReport,
  buildBudgetOverviewReport,
} from '@/lib/budget/reports'
import { buildBudgetWorkbook, buildBudgetExportFilename } from '@/lib/budget/budget-export'
import {
  buildBudgetSearchIndex,
  searchBudget,
  hasOnlyFuzzyHits,
  type BudgetSearchHit,
} from '@/lib/budget/budget-search'
import * as XLSX from 'xlsx'

function departmentPlanHasBudgetData(plan: BudgetState['plan']['departments'][BudgetDepartment]): boolean {
  return Object.values(plan.periods ?? {}).some((lines) => !!lines && Object.keys(lines).length > 0)
}

function createEmptyBudgetState(year: number): BudgetState {
  return {
    plan: {
      version: 1,
      year,
      departments: Object.fromEntries(
        BUDGET_DEPTS.map((department) => [
          department,
          {
            version: 1,
            year,
            department,
            periods: { annual: {} },
            source: 'placeholder-static',
            importMeta: null,
          },
        ]),
      ) as BudgetState['plan']['departments'],
      source: 'placeholder-static',
      lastUpdatedAt: null,
    },
    team: {
      version: 1,
      year,
      members: [],
      source: 'placeholder-static',
      lastUpdatedAt: null,
      lastUpdatedBy: null,
    },
  }
}

const BUDGET_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'headcount', label: 'Headcount' },
  { key: 'team', label: 'Team Tracker' },
  { key: 'mapping', label: 'QB Mapping' },
  { key: 'coverage', label: 'Coverage' },
]
const AUTO_ACTUALS_DEBOUNCE_MS = 250

function getBudgetViewCacheKey(view: BudgetViewState): string {
  return [
    view.year,
    view.entity,
    view.mode,
    view.month,
    view.rangeStart,
    view.rangeEnd,
  ].join(':')
}

function getBudgetDepartmentCacheKey(view: BudgetViewState, department: BudgetDepartmentActualScope): string {
  return `${getBudgetViewCacheKey(view)}:${department}`
}

function formatBudgetVariance(varianceUsd: number | null): string {
  if (varianceUsd === null) return '—'
  if (Math.abs(varianceUsd) < 0.5) return fmtUSD(0, 0)
  return fmtUSD(varianceUsd, 0)
}

function getBudgetVarianceTone(varianceUsd: number | null): 'green' | 'red' | '' {
  if (varianceUsd === null || Math.abs(varianceUsd) < 0.5) return ''
  return varianceUsd < 0 ? 'green' : 'red'
}

function kindBadge(kind: BudgetSearchHit['kind']): string {
  switch (kind) {
    case 'line-item':   return 'Line'
    case 'category':    return 'Category'
    case 'department':  return 'Dept'
    case 'team-member': return 'Person'
    case 'transaction': return 'Txn'
    default:            return ''
  }
}

export default function BudgetPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [activeDept, setActiveDept] = useState<BudgetDepartmentViewScope | ''>('')
  const [budgetYear, setBudgetYear] = useState(() => normalizeBudgetYear(2026))
  const [budgetView, setBudgetView] = useState<BudgetViewState>(() => getDefaultBudgetViewState(2026))
  const [teamSearch, setTeamSearch] = useState('')
  const [teamDeptFilter, setTeamDeptFilter] = useState('')
  const [teamEntityFilter, setTeamEntityFilter] = useState('')
  const [teamStatusFilter, setTeamStatusFilter] = useState('active')
  const [teamSort, setTeamSort] = useState<{ key: BudgetTeamSortKey; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc',
  })
  const [selectedHeadcountDepartment, setSelectedHeadcountDepartment] = useState<BudgetDepartment | null>(null)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false)
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false)
  const [isQbModalOpen, setIsQbModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<BudgetTeamMember | null>(null)
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null)
  const [qbNotice, setQbNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [budgetState, setBudgetState] = useState<BudgetState>(() => createEmptyBudgetState(2026))
  const [mappingState, setMappingState] = useState<BudgetQbMappingState | null>(null)
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappingSaving, setMappingSaving] = useState(false)
  const [mappingError, setMappingError] = useState<string | null>(null)
  const [coverageState, setCoverageState] = useState<BudgetCoverageState | null>(null)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [coverageError, setCoverageError] = useState<string | null>(null)
  const [suggestedMappingAccount, setSuggestedMappingAccount] = useState<string | null>(null)
  const [headcountActualsCache, setHeadcountActualsCache] = useState<Record<string, BudgetHeadcountActualsState>>({})
  const [headcountActualsLoading, setHeadcountActualsLoading] = useState(false)
  const [headcountActualsError, setHeadcountActualsError] = useState<string | null>(null)
  const [revenueModalOpen, setRevenueModalOpen] = useState(false)
  const [revenueModalLoading, setRevenueModalLoading] = useState(false)
  const [revenueModalError, setRevenueModalError] = useState<string | null>(null)
  const [revenueMonthlyCache, setRevenueMonthlyCache] = useState<Record<number, BudgetRevenueMonthlyBreakdown>>({})
  const [planBreakdown, setPlanBreakdown] = useState<BudgetPlanBreakdownState | null>(null)
  const [actualDrillOpen, setActualDrillOpen] = useState(false)
  const [actualDrillTitle, setActualDrillTitle] = useState('')
  const [actualDrill, setActualDrill] = useState<BudgetActualDrillState | null>(null)
  const [actualDrillLoading, setActualDrillLoading] = useState(false)
  const [actualDrillError, setActualDrillError] = useState<string | null>(null)
  const [overviewActualsCache, setOverviewActualsCache] = useState<Record<string, BudgetOverviewActualsState>>({})
  const [departmentActualsCache, setDepartmentActualsCache] = useState<Record<string, BudgetDepartmentActualsState>>({})
  const [actualsLoading, setActualsLoading] = useState(false)
  const [qbStatuses, setQbStatuses] = useState<QboConnectionStatus[]>([])
  const [qbStatusLoading, setQbStatusLoading] = useState(false)
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamLoaded, setTeamLoaded] = useState(false)
  const [budgetError, setBudgetError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [allowedBudgetMonthIndices, setAllowedBudgetMonthIndices] = useState<number[] | null>(null)
  const attemptedAutoActualKeysRef = useRef<Set<string>>(new Set())
  // Search box state: raw input, debounced query used for actual matching,
  // and open/closed for the results dropdown.
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)
  // Full drilldown state (transactions + accounts) for the current view,
  // cached per view+dept key. Search matches over transactions; accounts
  // give us the account→lineKey mapping so a tx click can open the drill
  // modal on the containing line item directly.
  const [searchDrillCache, setSearchDrillCache] = useState<Record<string, BudgetActualDrillState>>({})
  const [searchTxLoading, setSearchTxLoading] = useState(false)
  const searchTxAttemptedRef = useRef<Set<string>>(new Set())
  // When a search hit needs to open the drill modal, we may have just
  // changed the department — overviewReport rebuilds on the next render.
  // Store the requested line key and open the drill in an effect once the
  // report reflects the new scope.
  const [pendingDrillLineKey, setPendingDrillLineKey] = useState<string | null>(null)
  const { access, loading: accessLoading, error: accessError } = useSharedAccess()
  const canViewBudget = hasBudgetPageAccess(access)
  const allowedBudgetViewModes = useMemo(() => getAllowedBudgetViewModes(access), [access])
  const allowedBudgetEntities = useMemo(() => getAllowedBudgetEntities(access), [access])
  const canUseAllDepartmentsOverview = useMemo(() => canViewBudgetOverviewAllDepartments(access), [access])
  const isDepartmentScopedOverview = access ? !canUseAllDepartmentsOverview : false
  const canSelectDepartmentOnOverview = access?.role === 'admin' || isDepartmentScopedOverview
  const preferredBudgetDepartment = useMemo(() => getDefaultBudgetDepartment(access), [access])
  const visibleBudgetTabKeys = useMemo(() => getVisibleBudgetTabs(access), [access])
  const visibleBudgetTabs = useMemo(
    () => BUDGET_TABS.filter((tab) => visibleBudgetTabKeys.includes(tab.key)),
    [visibleBudgetTabKeys],
  )
  // Only surface months that have been closed (the 16th of the month AFTER
  // them). Restrictive when the user is on the current year; past years show
  // all months, future years show none.
  const selectableMonthIndices = useMemo(() => {
    const closed = getClosedBudgetMonthIndices(budgetYear)
    if (!allowedBudgetMonthIndices || allowedBudgetMonthIndices.length === 0) return closed
    return closed.filter((m) => allowedBudgetMonthIndices.includes(m))
  }, [allowedBudgetMonthIndices, budgetYear])

  async function loadBudgetBootstrap(noCache = false) {
    setLoading(true)
    setQbStatusLoading(true)
    setBudgetError(null)

    try {
      const bootstrap = await apiFetch<BudgetBootstrapResponse>(`/api/budget/bootstrap?year=${budgetYear}${noCache ? '&fresh=1' : ''}`)
      setBudgetState(bootstrap.state)
      // Viewers receive `qbStatuses: null` — they don't see QB connection
      // details. Treat that the same as an empty array on the client.
      setQbStatuses(bootstrap.qbStatuses ?? [])
      setAllowedBudgetMonthIndices(bootstrap.allowedBudgetMonthIndices)

      if (bootstrap.qbStatusError) {
        setQbNotice({
          tone: 'warn',
          text: bootstrap.qbStatusError,
        })
      }
    } catch (error) {
      setBudgetError(error instanceof Error ? error.message : 'Failed to load budget data.')
      setBudgetState(createEmptyBudgetState(budgetYear))
      setQbStatuses([])
      setAllowedBudgetMonthIndices(null)
    } finally {
      setLoading(false)
      setQbStatusLoading(false)
    }
  }

  async function loadBudgetState(noCache = false) {
    setLoading(true)
    setBudgetError(null)
    try {
      const state = await apiFetch<BudgetState>(`/api/budget/state?year=${budgetYear}${noCache ? '&fresh=1' : ''}`)
      // /api/budget/state returns plan only (team is lazy via /api/budget/team).
      // Preserve any team we've already loaded into client state.
      setBudgetState((prev) => ({ ...state, team: prev.team }))
    } catch (error) {
      setBudgetError(error instanceof Error ? error.message : 'Failed to load budget data.')
      setBudgetState(createEmptyBudgetState(budgetYear))
    } finally {
      setLoading(false)
    }
  }

  async function loadBudgetTeam(noCache = false) {
    setTeamLoading(true)
    try {
      const team = await apiFetch<BudgetTeamState>(`/api/budget/team?year=${budgetYear}${noCache ? '&fresh=1' : ''}`)
      setBudgetState((prev) => ({ ...prev, team }))
      setTeamLoaded(true)
    } catch (error) {
      console.error('[budget] loadBudgetTeam failed', error)
    } finally {
      setTeamLoading(false)
    }
  }

  async function loadBudgetMapping(noCache = false) {
    setMappingLoading(true)
    setMappingError(null)
    try {
      const mapping = await apiFetch<BudgetQbMappingState>(`/api/budget/mapping?year=${budgetYear}${noCache ? '&fresh=1' : ''}`)
      setMappingState(mapping)
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : 'Failed to load QB mapping.')
      setMappingState(null)
    } finally {
      setMappingLoading(false)
    }
  }

  useEffect(() => {
    setLastActionMessage(null)
  }, [budgetYear])

  useEffect(() => {
    setMappingState(null)
    setMappingError(null)
    setSuggestedMappingAccount(null)
    // Year change invalidates lazy team data; force a refetch on next tab activation.
    setTeamLoaded(false)
  }, [budgetYear])

  useEffect(() => {
    setCoverageState(null)
    setCoverageError(null)
    setHeadcountActualsError(null)
    setPlanBreakdown(null)
    setActualDrillOpen(false)
    setActualDrill(null)
    setActualDrillError(null)
  }, [budgetYear, budgetView.entity, budgetView.mode, budgetView.month, budgetView.rangeStart, budgetView.rangeEnd])

  useEffect(() => {
    setQbNotice(null)
  }, [budgetYear, budgetView.entity, budgetView.mode, budgetView.month, budgetView.rangeStart, budgetView.rangeEnd])

  useEffect(() => {
    setBudgetView((current) => clampBudgetViewState({
      ...current,
      year: budgetYear,
    }, {
      allowedMonthIndices: selectableMonthIndices,
      allowedModes: allowedBudgetViewModes,
      allowedEntities: allowedBudgetEntities,
    }))
  }, [allowedBudgetEntities, selectableMonthIndices, allowedBudgetViewModes, budgetYear])

  useEffect(() => {
    if (accessLoading) return

    if (!canViewBudget) {
      setLoading(false)
      setBudgetState(createEmptyBudgetState(budgetYear))
      setQbStatuses([])
      setAllowedBudgetMonthIndices(null)
      return
    }

    void loadBudgetBootstrap()
  }, [access, accessLoading, budgetYear, canViewBudget])

  async function loadQbStatus() {
    setQbStatusLoading(true)
    try {
      const response = await apiFetch<QboStatusResponse>('/api/qb/status')
      setQbStatuses(response.entities)
    } catch (error) {
      setQbNotice({
        tone: 'warn',
        text: error instanceof Error ? error.message : 'Failed to load QuickBooks connection status.',
      })
    } finally {
      setQbStatusLoading(false)
    }
  }

  useEffect(() => {
    if (!canViewBudget || activeTab !== 'mapping') return
    if (mappingState || mappingLoading) return
    void loadBudgetMapping()
  }, [activeTab, canViewBudget, mappingLoading, mappingState])

  useEffect(() => {
    if (!canViewBudget || activeTab !== 'coverage') return
    if (coverageState || coverageLoading || coverageError) return
    void fetchCoverage()
  }, [activeTab, canViewBudget, coverageLoading, coverageState, coverageError])

  // Lazy-load team data when the user activates a tab that needs it. Bootstrap
  // skips team for everyone — only Headcount and Team tabs read team rows,
  // both tabs are admin-only via getVisibleBudgetTabs. Also pre-load for admins
  // regardless of tab so the top-bar Search box can index people from any tab
  // (dropping to a person via search would otherwise miss until the user
  // opened Team/Headcount first). Non-admin path is untouched — the endpoint
  // itself is admin-only, and their search index gets teamMembers=[].
  useEffect(() => {
    if (!canViewBudget) return
    const needsTeam = activeTab === 'headcount' || activeTab === 'team' || access?.role === 'admin'
    if (!needsTeam) return
    if (teamLoaded || teamLoading) return
    void loadBudgetTeam()
  }, [activeTab, canViewBudget, teamLoaded, teamLoading, access?.role])

  useEffect(() => {
    function handleQbAuthSuccess(event: MessageEvent) {
      if (event.data?.type !== 'QB_AUTH_SUCCESS') return
      setQbNotice({
        tone: 'ok',
        text: `QuickBooks connected for ${event.data.entity}.`,
      })
      void loadQbStatus()
    }

    window.addEventListener('message', handleQbAuthSuccess)
    return () => window.removeEventListener('message', handleQbAuthSuccess)
  }, [])

  const filteredTeam = useMemo(() => {
    return filterBudgetTeam(budgetState.team.members, {
      dept: teamDeptFilter,
      entity: teamEntityFilter,
      search: teamSearch,
      status: teamStatusFilter,
    })
  }, [budgetState.team.members, teamDeptFilter, teamEntityFilter, teamSearch, teamStatusFilter])

  const visibleTeam = useMemo(() => {
    return sortBudgetTeam(filteredTeam, teamSort.key, teamSort.direction)
  }, [filteredTeam, teamSort.direction, teamSort.key])

  const overviewActualsCacheKey = useMemo(() => getBudgetViewCacheKey(budgetView), [budgetView])
  const overviewActuals = overviewActualsCache[overviewActualsCacheKey] ?? null
  const headcountActuals = headcountActualsCache[overviewActualsCacheKey] ?? null

  const headcountByDepartment = useMemo(() => {
    return getHeadcountByDepartment(budgetState.team.members, headcountActuals?.departments ?? null)
  }, [budgetState.team.members, headcountActuals])

  const allowedDepartments = useMemo<readonly BudgetDepartment[]>(() => {
    if (access?.role === 'admin' || access?.permissions?.budgetDepartments === null) return BUDGET_DEPTS

    const scoped = access?.permissions?.budgetDepartments ?? []
    return BUDGET_DEPTS.filter((department) => scoped.includes(department))
  }, [access])
  const fallbackOverviewDepartment = useMemo<BudgetDepartment | null>(() => {
    const normalizedPreferredDepartment = preferredBudgetDepartment && allowedDepartments.includes(preferredBudgetDepartment as BudgetDepartment)
      ? preferredBudgetDepartment as BudgetDepartment
      : null
    return normalizedPreferredDepartment ?? allowedDepartments[0] ?? null
  }, [allowedDepartments, preferredBudgetDepartment])
  const planCoverageDepartments = useMemo<readonly BudgetDepartment[]>(
    () => canUseAllDepartmentsOverview ? BUDGET_DEPTS : allowedDepartments,
    [allowedDepartments, canUseAllDepartmentsOverview],
  )
  const importedPlanDepartments = useMemo(() => (
    planCoverageDepartments.filter((department) => {
      const plan = budgetState.plan.departments[department]
      return plan?.source === 'sheet-import' && departmentPlanHasBudgetData(plan)
    })
  ), [budgetState.plan.departments, planCoverageDepartments])
  const missingImportedPlanDepartments = useMemo(() => (
    budgetState.plan.source === 'sheet-import'
      ? planCoverageDepartments.filter((department) => !importedPlanDepartments.includes(department))
      : []
  ), [budgetState.plan.source, importedPlanDepartments, planCoverageDepartments])
  const canImportPlan = access?.role === 'admin'
  const canManageTeam = access?.role === 'admin' || access?.permissions?.canManageBudgetTeam === true
  const canOpenQbConnect = access?.role === 'admin'
  const canFetchOverview = canFetchBudgetActuals(budgetView.entity, qbStatuses)
  const canUseAllDepartments = canUseAllDepartmentsOverview
  const departmentOptions = useMemo<readonly BudgetDepartmentViewScope[]>(() => {
    const options: BudgetDepartmentViewScope[] = []
    if (canUseAllDepartments) options.push('All')
    options.push(...allowedDepartments)
    return options
  }, [allowedDepartments, canUseAllDepartments])
  const defaultDepartmentOption = useMemo<BudgetDepartmentViewScope | ''>(() => {
    if (isDepartmentScopedOverview) {
      return fallbackOverviewDepartment ?? ''
    }

    return departmentOptions[0] ?? ''
  }, [departmentOptions, fallbackOverviewDepartment, isDepartmentScopedOverview])
  const departmentActualsCacheKey = useMemo<string | null>(() => {
    const requestedDepartment =
      activeDept && activeDept !== 'All'
        ? activeDept
        : (isDepartmentScopedOverview ? fallbackOverviewDepartment : null)

    if (!requestedDepartment) return null
    return getBudgetDepartmentCacheKey(budgetView, requestedDepartment)
  }, [activeDept, budgetView, fallbackOverviewDepartment, isDepartmentScopedOverview])
  const departmentActuals = departmentActualsCacheKey ? departmentActualsCache[departmentActualsCacheKey] ?? null : null
  const overviewSelectedDepartment = useMemo<BudgetDepartmentActualScope | null>(() => {
    if (!canSelectDepartmentOnOverview) return null
    if (activeDept && activeDept !== 'All') return activeDept
    return defaultDepartmentOption && defaultDepartmentOption !== 'All'
      ? defaultDepartmentOption
      : null
  }, [activeDept, canSelectDepartmentOnOverview, defaultDepartmentOption])
  const selectedDepartmentScope = useMemo<BudgetDepartmentActualScope | null>(() => {
    if (activeTab === 'overview') return overviewSelectedDepartment
    if (activeDept && activeDept !== 'All') return activeDept
    return null
  }, [activeDept, activeTab, overviewSelectedDepartment])
  const activeActualRequest = useMemo(() => getBudgetActualRequest({
    activeDepartment: activeDept,
    activeTab,
    departmentCacheKey: departmentActualsCacheKey,
    headcountCacheKey: overviewActualsCacheKey,
    overviewCacheKey: overviewActualsCacheKey,
    overviewDepartment: overviewSelectedDepartment,
  }), [
    activeDept,
    activeTab,
    departmentActualsCacheKey,
    overviewActualsCacheKey,
    overviewSelectedDepartment,
  ])
  const activeActualsLoaded = useMemo(() => {
    if (!activeActualRequest) return false
    if (activeActualRequest.kind === 'overview') return overviewActuals !== null
    if (activeActualRequest.kind === 'department') return departmentActuals !== null
    return headcountActuals !== null
  }, [activeActualRequest, departmentActuals, headcountActuals, overviewActuals])
  const activeActualsLoading = activeActualRequest?.kind === 'headcount'
    ? headcountActualsLoading
    : (activeActualRequest ? actualsLoading : false)
  const overviewReport = useMemo(() => {
    if (overviewSelectedDepartment) {
      const report = buildBudgetDepartmentReport(budgetState.plan, overviewSelectedDepartment, budgetView)
      return departmentActuals && departmentActuals.department === overviewSelectedDepartment
        ? applyBudgetDepartmentActuals(report, departmentActuals)
        : report
    }

    const report = buildBudgetOverviewReport(budgetState.plan, BUDGET_DEPTS, budgetView)
    return overviewActuals ? applyBudgetOverviewActuals(report, overviewActuals) : report
  }, [budgetState.plan, budgetView, departmentActuals, overviewActuals, overviewSelectedDepartment])
  const missingQboEntities = getMissingQboEntities(budgetView.entity, qbStatuses)
  const teamSourceLabel = budgetState.team.source === 'app-managed' ? 'App-managed team' : 'Placeholder team'
  const teamUpdatedLabel = budgetState.team.lastUpdatedAt
    ? `${new Date(budgetState.team.lastUpdatedAt).toLocaleString()}${budgetState.team.lastUpdatedBy ? ` by ${budgetState.team.lastUpdatedBy}` : ''}`
    : 'Not updated yet'
  const budgetPageSub = `${budgetView.entity === 'All' ? 'All Entities' : budgetView.entity} · ${budgetYear}`
  const visibleHeadcountByDepartment = useMemo(
    () => headcountByDepartment.filter((entry) => allowedDepartments.includes(entry.dept)),
    [allowedDepartments, headcountByDepartment],
  )
  const headcountSummary = useMemo(
    () => getBudgetHeadcountSummary(visibleHeadcountByDepartment),
    [visibleHeadcountByDepartment],
  )
  const headcountModalMembers = useMemo(() => {
    if (!selectedHeadcountDepartment) return []
    return sortBudgetTeam(
      budgetState.team.members.filter((member) => (
        member.dept === selectedHeadcountDepartment && member.status !== 'Terminated'
      )),
      'name',
      'asc',
    )
  }, [budgetState.team.members, selectedHeadcountDepartment])
  const headcountScopeLabel = useMemo(
    () => `${budgetView.entity === 'All' ? 'All Entities' : budgetView.entity} · ${budgetView.mode === 'ytd' ? getBudgetScopeYtdLabel(budgetView) : getBudgetScopePeriodLabel(budgetView)}`,
    [budgetView],
  )
  const teamSummary = useMemo(() => {
    return getBudgetTeamSummary(
      budgetState.team.members.filter((member) => allowedDepartments.includes(member.dept)),
      { entity: teamEntityFilter || undefined },
    )
  }, [allowedDepartments, budgetState.team.members, teamEntityFilter])
  const headcountTerminatedVisible = useMemo(
    () => visibleHeadcountByDepartment.reduce((sum, entry) => sum + entry.terminatedCount, 0),
    [visibleHeadcountByDepartment],
  )
  const headcountSalaryProgressPct = useMemo(() => {
    if (headcountSummary.totalSalaryBudgetUsd <= 0 || headcountSummary.totalSalaryActualUsd <= 0) return 0
    return Math.min((headcountSummary.totalSalaryActualUsd / headcountSummary.totalSalaryBudgetUsd) * 100, 100)
  }, [headcountSummary.totalSalaryActualUsd, headcountSummary.totalSalaryBudgetUsd])
  const teamSummaryScopeLabel = teamEntityFilter || 'All Entities'
  const visibleTeamTotals = useMemo(() => ({
    salaryUsd: visibleTeam.reduce((sum, member) => sum + (member.salary || 0), 0),
    bonusUsd: visibleTeam.reduce((sum, member) => sum + (member.bonus || 0), 0),
    totalCompUsd: visibleTeam.reduce((sum, member) => sum + (member.salary || 0) + (member.bonus || 0), 0),
  }), [visibleTeam])

  useEffect(() => {
    const fallbackTab = visibleBudgetTabs[0]?.key ?? 'overview'
    if (!visibleBudgetTabKeys.includes(activeTab)) {
      setActiveTab(fallbackTab)
    }
  }, [activeTab, visibleBudgetTabKeys, visibleBudgetTabs])

  useEffect(() => {
    const defaultDepartment = defaultDepartmentOption
    if (!activeDept && defaultDepartment) {
      setActiveDept(defaultDepartment)
      return
    }

    if (activeDept && !departmentOptions.includes(activeDept)) {
      setActiveDept(defaultDepartment)
    }
  }, [activeDept, defaultDepartmentOption, departmentOptions])

  function toggleTeamSort(key: BudgetTeamSortKey) {
    setTeamSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function sortIndicator(key: BudgetTeamSortKey) {
    if (teamSort.key !== key) return ''
    return teamSort.direction === 'asc' ? ' ↑' : ' ↓'
  }

  function openBudgetBreakdown(row: BudgetReportRow, column: BudgetReportColumnKey) {
    if (!canOpenBudgetPlanBreakdown(row, column)) return

    const departments: BudgetDepartmentActualScope[] =
      ((activeTab === 'overview' && selectedDepartmentScope !== null) && selectedDepartmentScope)
        ? [selectedDepartmentScope]
        : [...planCoverageDepartments]

    setPlanBreakdown(buildBudgetPlanBreakdown(budgetState.plan, departments, budgetView, row, column))
  }

  async function openActualDrill(row: BudgetReportRow, column: BudgetReportColumnKey, report: typeof overviewReport) {
    if (!canOpenBudgetActualDrill(row, column, report)) return

    const keys = row.actualKeys ?? [row.key]
    const department = ((activeTab === 'overview' && selectedDepartmentScope !== null) && selectedDepartmentScope)
      ? selectedDepartmentScope
      : null
    const params = new URLSearchParams({
      year: String(budgetView.year),
      entity: budgetView.entity,
      mode: budgetView.mode,
      month: String(budgetView.month),
      rangeStart: String(budgetView.rangeStart),
      rangeEnd: String(budgetView.rangeEnd),
      column,
      keys: keys.join(','),
    })
    if (department) {
      params.set('department', department)
    }

    setActualDrillTitle(getBudgetActualDrillTitle(row.label, budgetView, column, keys))
    setActualDrillOpen(true)
    setActualDrillLoading(true)
    setActualDrillError(null)
    setActualDrill(null)

    try {
      const drill = await apiFetch<BudgetActualDrillState>(`/api/budget/actuals/drill?${params.toString()}`)
      setActualDrill(drill)
    } catch (error) {
      setActualDrillError(error instanceof Error ? error.message : 'Failed to load QuickBooks GL detail.')
    } finally {
      setActualDrillLoading(false)
    }
  }

  async function fetchOverviewActuals(trigger: 'auto' | 'manual' = 'manual') {
    const cacheKey = overviewActualsCacheKey
    setActualsLoading(true)
    if (trigger === 'manual') {
      setQbNotice(null)
    }

    try {
      const params = new URLSearchParams({
        year: String(budgetView.year),
        entity: budgetView.entity,
        mode: budgetView.mode,
        month: String(budgetView.month),
        rangeStart: String(budgetView.rangeStart),
        rangeEnd: String(budgetView.rangeEnd),
      })
      const actuals = await apiFetch<BudgetOverviewActualsState>(`/api/budget/actuals?${params.toString()}`)
      setOverviewActualsCache((current) => ({ ...current, [cacheKey]: actuals }))
      if (trigger === 'manual') {
        setQbNotice({
          tone: 'ok',
          text: `QuickBooks actuals updated for ${budgetView.entity === 'All' ? 'all entities' : budgetView.entity}.`,
        })
      }
    } catch (error) {
      setQbNotice({
        tone: 'warn',
        text: error instanceof Error ? error.message : 'Failed to fetch QuickBooks actuals.',
      })
    } finally {
      setActualsLoading(false)
    }
  }

  async function fetchDepartmentActuals(trigger: 'auto' | 'manual' = 'manual') {
    const requestedDepartment = activeDept && activeDept !== 'All'
      ? activeDept
      : overviewSelectedDepartment
    if (!requestedDepartment) return
    const cacheKey = getBudgetDepartmentCacheKey(budgetView, requestedDepartment)

    setActualsLoading(true)
    if (trigger === 'manual') {
      setQbNotice(null)
    }

    try {
      const params = new URLSearchParams({
        year: String(budgetView.year),
        entity: budgetView.entity,
        mode: budgetView.mode,
        month: String(budgetView.month),
        rangeStart: String(budgetView.rangeStart),
        rangeEnd: String(budgetView.rangeEnd),
        department: requestedDepartment,
      })
      const actuals = await apiFetch<BudgetDepartmentActualsState>(`/api/budget/actuals/department?${params.toString()}`)
      setDepartmentActualsCache((current) => ({ ...current, [cacheKey]: actuals }))

      const unclassifiedTotal = Object.values(actuals.unclassifiedLines.annual).reduce((sum, value) => sum + (value ?? 0), 0)
      const showUnclassifiedWarning = access?.role === 'admin' && unclassifiedTotal > 0
      if (trigger === 'manual' || showUnclassifiedWarning) {
        setQbNotice({
          tone: showUnclassifiedWarning ? 'warn' : 'ok',
          text: showUnclassifiedWarning
            ? `QuickBooks actuals updated for ${requestedDepartment}. ${fmtUSD(unclassifiedTotal, 0)} remains unclassified and is excluded from this department view.`
            : `QuickBooks actuals updated for ${requestedDepartment}.`,
        })
      }
    } catch (error) {
      setQbNotice({
        tone: 'warn',
        text: error instanceof Error ? error.message : 'Failed to fetch department QuickBooks actuals.',
      })
    } finally {
      setActualsLoading(false)
    }
  }

  async function openRevenueMonthlyModal() {
    setRevenueModalOpen(true)
    setRevenueModalError(null)

    if (revenueMonthlyCache[budgetYear]) return

    setRevenueModalLoading(true)
    try {
      const breakdown = await apiFetch<BudgetRevenueMonthlyBreakdown>(`/api/budget/revenue/monthly?year=${budgetYear}`)
      setRevenueMonthlyCache((current) => ({ ...current, [budgetYear]: breakdown }))
    } catch (error) {
      setRevenueModalError(error instanceof Error ? error.message : 'Failed to load monthly revenue.')
    } finally {
      setRevenueModalLoading(false)
    }
  }

  async function fetchHeadcountActuals(trigger: 'auto' | 'manual' = 'manual') {
    const cacheKey = overviewActualsCacheKey
    setHeadcountActualsLoading(true)
    setHeadcountActualsError(null)
    if (trigger === 'manual') {
      setQbNotice(null)
    }

    try {
      const params = new URLSearchParams({
        year: String(budgetView.year),
        entity: budgetView.entity,
        mode: budgetView.mode,
        month: String(budgetView.month),
        rangeStart: String(budgetView.rangeStart),
        rangeEnd: String(budgetView.rangeEnd),
      })
      const actuals = await apiFetch<BudgetHeadcountActualsState>(`/api/budget/headcount/actuals?${params.toString()}`)
      setHeadcountActualsCache((current) => ({ ...current, [cacheKey]: actuals }))
      if (trigger === 'manual' || actuals.unclassifiedTotalUsd > 0) {
        setQbNotice({
          tone: actuals.unclassifiedTotalUsd > 0 ? 'warn' : 'ok',
          text: actuals.unclassifiedTotalUsd > 0
            ? `Headcount actuals updated for ${headcountScopeLabel}. ${fmtUSD(actuals.unclassifiedTotalUsd, 0)} of compensation actuals could not be classified to a department.`
            : `Headcount actuals updated for ${headcountScopeLabel}.`,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch headcount actuals.'
      setHeadcountActualsError(message)
      setQbNotice({ tone: 'warn', text: message })
    } finally {
      setHeadcountActualsLoading(false)
    }
  }

  async function fetchCoverage() {
    setCoverageLoading(true)
    setCoverageError(null)
    setQbNotice(null)

    try {
      const params = new URLSearchParams({
        year: String(budgetView.year),
        entity: budgetView.entity,
        mode: budgetView.mode,
        month: String(budgetView.month),
        rangeStart: String(budgetView.rangeStart),
        rangeEnd: String(budgetView.rangeEnd),
      })
      const coverage = await apiFetch<BudgetCoverageState>(`/api/budget/coverage?${params.toString()}`)
      setCoverageState(coverage)
      setQbNotice({
        tone: 'ok',
        text: `Coverage updated for ${budgetView.entity === 'All' ? 'all entities' : budgetView.entity}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch QuickBooks coverage.'
      setCoverageError(message)
      setQbNotice({ tone: 'warn', text: message })
    } finally {
      setCoverageLoading(false)
    }
  }

  const coverageExportHref = useMemo(() => {
    if (!coverageState) return null
    const params = new URLSearchParams({
      year: String(budgetView.year),
      entity: budgetView.entity,
      mode: budgetView.mode,
      month: String(budgetView.month),
      rangeStart: String(budgetView.rangeStart),
      rangeEnd: String(budgetView.rangeEnd),
    })
    return `/api/budget/coverage/export?${params.toString()}`
  }, [coverageState, budgetView])

  async function excludeAccount(accountNumber: string) {
    const reason = window.prompt(`Reason for excluding account ${accountNumber}:`)?.trim()
    if (!reason) return
    try {
      const response = await fetch('/api/budget/coverage/exclusions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber, reason }),
      })
      if (response.status === 409) {
        const body = await response.json().catch(() => ({}))
        window.alert(body.error ?? `Account ${accountNumber} is mapped.`)
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await fetchCoverage()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to exclude account.')
    }
  }

  async function unExcludeAccount(accountNumber: string) {
    try {
      const response = await fetch(`/api/budget/coverage/exclusions?accountNumber=${encodeURIComponent(accountNumber)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await fetchCoverage()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to remove exclusion.')
    }
  }

  async function drillCoverageAccount(accountNumber: string, accountName: string | null) {
    setActualDrillTitle(`Account ${accountNumber}${accountName ? ` — ${accountName}` : ''}`)
    setActualDrillOpen(true)
    setActualDrillLoading(true)
    setActualDrillError(null)
    setActualDrill(null)

    const params = new URLSearchParams({
      year: String(budgetView.year),
      entity: budgetView.entity,
      mode: budgetView.mode,
      month: String(budgetView.month),
      rangeStart: String(budgetView.rangeStart),
      rangeEnd: String(budgetView.rangeEnd),
      accountNumber,
    })

    try {
      const drill = await apiFetch<BudgetActualDrillState>(`/api/budget/coverage/drill?${params.toString()}`)
      setActualDrill(drill)
    } catch (error) {
      setActualDrillError(error instanceof Error ? error.message : 'Failed to load account drill.')
    } finally {
      setActualDrillLoading(false)
    }
  }

  function unmapStaleAccount({ accountNumber, mappingLine }: { accountNumber: string; mappingLine: string }) {
    if (!window.confirm(`Unmap account ${accountNumber} from "${mappingLine}"? This removes the mapping row.`)) return
    setSuggestedMappingAccount(accountNumber)
    setActiveTab('mapping')
    if (!mappingState && !mappingLoading) {
      void loadBudgetMapping()
    }
  }

  async function saveBudgetMapping(rows: BudgetQbMappingRow[]) {
    setMappingSaving(true)
    setMappingError(null)

    try {
      const result = await apiPost<BudgetQbMappingMutationResult>('/api/budget/mapping', {
        year: budgetYear,
        rows,
      })
      setMappingState(result.mapping)
      setCoverageState(null)
      setCoverageError(null)
      setLastActionMessage(`Saved QB mapping for ${budgetYear}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save QB mapping.'
      setMappingError(message)
      throw error
    } finally {
      setMappingSaving(false)
    }
  }

  useEffect(() => {
    // canFetchOverview is derived from qbStatuses, which /api/budget/bootstrap
    // intentionally returns as null for non-admins (privacy — don't leak realm
    // ids / refresh metadata). That makes the guard reject viewer requests
    // even for their own department, so actuals never load and every cell
    // renders '—'. Bypass the guard when the request is department-scoped and
    // the user is not an admin: the /api/budget/actuals/department endpoint
    // enforces its own per-department access check (requireBudgetAccess with
    // { department }), so a viewer scoped to ['Legal'] can only pull Legal
    // data and any other department request is 403'd server-side. Admin path
    // is unchanged (canFetchOverview is always true for them, so skipQbGate
    // is irrelevant). Overview and headcount kinds still respect the guard.
    const skipQbGate = activeActualRequest?.kind === 'department' && access?.role !== 'admin'
    if ((!canFetchOverview && !skipQbGate) || !activeActualRequest || activeActualsLoaded || activeActualsLoading) return
    if (attemptedAutoActualKeysRef.current.has(activeActualRequest.requestKey)) return

    const timeoutId = setTimeout(() => {
      if (attemptedAutoActualKeysRef.current.has(activeActualRequest.requestKey)) return
      attemptedAutoActualKeysRef.current.add(activeActualRequest.requestKey)

      if (activeActualRequest.kind === 'overview') {
        void fetchOverviewActuals('auto')
        return
      }

      if (activeActualRequest.kind === 'department') {
        void fetchDepartmentActuals('auto')
        return
      }

      void fetchHeadcountActuals('auto')
    }, AUTO_ACTUALS_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [
    activeActualRequest,
    activeActualsLoaded,
    activeActualsLoading,
    canFetchOverview,
    access?.role,
  ])

  // --------- Search: debounce, index, hits, navigation ---------

  // Cache key for the current-view transactions fetch. When the user changes
  // month / entity / department, the key flips and we lazily re-fetch.
  const searchTxCacheKey = useMemo(() => {
    const dept = overviewSelectedDepartment && overviewSelectedDepartment !== 'Not specified'
      ? overviewSelectedDepartment
      : (activeDept && activeDept !== 'All' ? activeDept : 'ALL')
    return `${getBudgetViewCacheKey(budgetView)}:${dept}`
  }, [budgetView, overviewSelectedDepartment, activeDept])

  // Kick off a background fetch of every line-item's drill data as soon as
  // the user focuses the search box. Cached per view+dept key so navigating
  // around doesn't repeatedly re-fetch. Only runs when the drill endpoint is
  // callable — admins always, viewers only when the request is scoped to
  // their department (endpoint enforces this either way; the check just
  // avoids surfacing 403s).
  useEffect(() => {
    if (!searchOpen) return
    const key = searchTxCacheKey
    if (searchDrillCache[key] !== undefined) return
    if (searchTxAttemptedRef.current.has(key)) return
    searchTxAttemptedRef.current.add(key)

    const column: BudgetReportColumnKey =
      budgetView.mode === 'ytd' ? 'ytd' :
      budgetView.mode === 'range' ? 'annual' :
      'period'
    const allKeys = Array.from(new Set([
      // Every catalogued line + the aggregate 'total' keys some GL rows use.
      ...['salary', 'benefits', 'payroll', 'severance', 'bonus', 'commissions',
          'epdTools', 'bizTools', 'hosting', 'blockchainRpc', 'securityMon',
          'hrCosts', 'recruiting', 'meals', 'mktExp', 'profSvc', 'corpCompliance',
          'travel', 'colos', 'bankFees', 'rent', 'hardware',
          'corpFees', 'lobbying', 'mmFees', 'industryRelations', 'contingency'],
    ]))
    const dept = overviewSelectedDepartment && overviewSelectedDepartment !== 'Not specified'
      ? overviewSelectedDepartment
      : (activeDept && activeDept !== 'All' ? activeDept : null)

    const params = new URLSearchParams({
      year: String(budgetView.year),
      entity: budgetView.entity,
      mode: budgetView.mode,
      month: String(budgetView.month),
      rangeStart: String(budgetView.rangeStart),
      rangeEnd: String(budgetView.rangeEnd),
      column,
      keys: allKeys.join(','),
    })
    if (dept) params.set('department', dept)

    setSearchTxLoading(true)
    apiFetch<BudgetActualDrillState>(`/api/budget/actuals/drill?${params.toString()}`)
      .then((drill) => {
        setSearchDrillCache((prev) => ({ ...prev, [key]: drill }))
      })
      .catch((err) => {
        // Non-fatal — search still works with static entries. Log for triage.
        console.warn('[budget/search] tx fetch failed', err)
        // Cache a synthetic empty result so we don't re-try this key.
        setSearchDrillCache((prev) => ({
          ...prev,
          [key]: {
            source: 'quickbooks',
            year: budgetView.year,
            view: budgetView,
            department: null,
            fetchedAt: new Date().toISOString(),
            mappingSource: 'db',
            lineKeys: [],
            totalUsd: 0,
            unreconciledTotalUsd: 0,
            accounts: [],
            transactions: [],
          } as BudgetActualDrillState,
        }))
      })
      .finally(() => setSearchTxLoading(false))
  }, [searchOpen, searchTxCacheKey, searchDrillCache, budgetView, overviewSelectedDepartment, activeDept])

  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(searchInput.trim()), 200)
    return () => window.clearTimeout(t)
  }, [searchInput])

  // Close the results dropdown when the user clicks anywhere outside the box.
  useEffect(() => {
    if (!searchOpen) return
    const handleClick = (e: MouseEvent) => {
      const el = searchBoxRef.current
      if (el && !el.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [searchOpen])

  const searchDrill = searchDrillCache[searchTxCacheKey]
  const searchIndex = useMemo(() => buildBudgetSearchIndex({
    allowedDepartments,
    teamMembers: access?.role === 'admin' ? budgetState.team.members : [],
    canUseAllDepartments,
    transactions: searchDrill?.transactions,
    accounts: searchDrill?.accounts,
  }), [allowedDepartments, budgetState.team.members, canUseAllDepartments, access?.role, searchDrill])

  const searchHits = useMemo(() => searchQuery ? searchBudget(searchIndex, searchQuery) : [], [searchIndex, searchQuery])
  const searchAllFuzzy = useMemo(() => hasOnlyFuzzyHits(searchHits), [searchHits])

  function navigateToHit(hit: BudgetSearchHit) {
    // Apply navigation targets — tab first, then dept. If the hit has a
    // lineKey (line item OR transaction resolved via its account), also
    // schedule opening the drill modal once the report catches up to the
    // new scope. That gives viewers useful click behaviour (they can't
    // change dept anyway, but the drill opens right on the matching line).
    if (hit.navigate.tab) setActiveTab(hit.navigate.tab)
    if (hit.navigate.department !== undefined) setActiveDept(hit.navigate.department)
    if (hit.navigate.lineKey) setPendingDrillLineKey(hit.navigate.lineKey)
    // Month navigation intentionally omitted — no hit currently sets one and
    // BudgetViewState.month is a numeric index that needs converting from
    // the BudgetMonthKey string. Add a converter here if hits start carrying
    // a month later.
    setSearchInput('')
    setSearchQuery('')
    setSearchOpen(false)
  }

  // Once a pendingDrillLineKey is set AND the overview report reflects the
  // (possibly-changed) department scope, resolve the key to a report row and
  // open the drill modal on it. If the row isn't found we clear the pending
  // key immediately so we don't loop forever on stale scope.
  useEffect(() => {
    if (!pendingDrillLineKey || !overviewReport) return
    const row = overviewReport.rows.find((r) => {
      if (r.key === pendingDrillLineKey) return true
      return Array.isArray(r.actualKeys) && r.actualKeys.includes(pendingDrillLineKey)
    })
    setPendingDrillLineKey(null)
    if (row) void openActualDrill(row, 'period', overviewReport)
  }, [pendingDrillLineKey, overviewReport])

  // --------- Export: build workbook from current on-screen report ---------

  function handleExport() {
    // overviewReport is the exact table the user is looking at — already
    // access-filtered and scope-narrowed. Round-tripping through it means
    // Excel matches the screen 1:1.
    const report = overviewReport
    if (!report) return
    const department = overviewSelectedDepartment && overviewSelectedDepartment !== 'Not specified'
      ? overviewSelectedDepartment
      : null
    const sheetName = department ? `${department} ${report.periodLabel}` : `Overview ${report.periodLabel}`
    const filename = buildBudgetExportFilename({
      department,
      year: budgetYear,
      periodLabel: report.periodLabel,
    })
    const wb = buildBudgetWorkbook(report, sheetName)
    XLSX.writeFile(wb, filename)
  }

  function openQbConnect(entity: QboConnectionStatus['entity']) {
    setQbNotice(null)
    const popup = window.open(`/api/qb/connect?entity=${encodeURIComponent(entity)}`, 'qb-auth', 'popup=yes,width=720,height=760')
    if (!popup) {
      setQbNotice({
        tone: 'warn',
        text: 'Popup blocked. Allow popups for this site to connect QuickBooks.',
      })
    }
  }

  function openImportModal() {
    setIsImportModalOpen(true)
  }

  if (accessLoading) {
    return (
      <div className="budget-page">
        <div className="status-bar">
          <span className="status-dot loading" />
          <span className="status-text">Loading budget access…</span>
        </div>
      </div>
    )
  }

  if (!canViewBudget) {
    return (
      <div className="budget-page">
        <div className="empty budget-empty-inline">
          <div className="empty-icon">∅</div>
          <div>{accessError || 'Your account does not currently have budget access.'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="budget-page">
      <div className="page-header budget-page-header">
        <div>
          <div className="page-title">{budgetYear} Budget</div>
          <div className="page-sub">{budgetPageSub}</div>
        </div>
        <div className="budget-page-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Search box — matches line items, categories, departments, and
              (admin only) team members. Fuzzy, so 'gusavo' still finds
              'Gustavo Sabino' with a "no exact match" hint. */}
          <div ref={searchBoxRef} style={{ position: 'relative', minWidth: 260 }}>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search line items, departments, people…"
              style={{
                width: '100%',
                padding: '6px 10px',
                border: '1px solid var(--border, #ccc)',
                borderRadius: 4,
                background: 'var(--bg, #fff)',
                color: 'var(--text, #000)',
                fontSize: '0.85rem',
                fontFamily: 'var(--mono)',
              }}
              aria-label="Search the budget"
            />
            {searchOpen && searchQuery ? (
              <div
                role="listbox"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  maxHeight: 360,
                  overflowY: 'auto',
                  background: 'var(--card, #fff)',
                  color: 'var(--text, #000)',
                  border: '1px solid var(--border, #ccc)',
                  borderRadius: 4,
                  boxShadow: '0 8px 24px rgba(0,0,0,.15)',
                  zIndex: 50,
                  fontFamily: 'var(--mono)',
                  fontSize: '0.8rem',
                }}
              >
                {searchHits.length === 0 ? (
                  <div style={{ padding: 12, color: 'var(--muted, #888)' }}>
                    {searchTxLoading
                      ? `Loading transactions for the current view… (search matches static items right now — retry once loaded)`
                      : `No matches for "${searchQuery}".`}
                  </div>
                ) : (
                  <>
                    {searchTxLoading ? (
                      <div style={{
                        padding: '6px 12px',
                        borderBottom: '1px solid var(--border, #eee)',
                        color: 'var(--muted, #888)',
                        fontSize: '0.7rem',
                      }}>
                        Loading transactions for the current view…
                      </div>
                    ) : null}
                    {searchAllFuzzy ? (
                      <div style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid var(--border, #eee)',
                        color: '#d97706',
                        fontSize: '0.72rem',
                        letterSpacing: '.02em',
                      }}>
                        ⚠ No exact match — showing closest results
                      </div>
                    ) : null}
                    {searchHits.map((hit, idx) => (
                      <button
                        key={`${hit.kind}:${hit.label}:${idx}`}
                        role="option"
                        onClick={() => navigateToHit(hit)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: idx === searchHits.length - 1 ? 'none' : '1px solid var(--border, #eee)',
                          padding: '8px 12px',
                          cursor: 'pointer',
                          color: 'inherit',
                          fontFamily: 'inherit',
                          fontSize: 'inherit',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: '0.65rem', color: 'var(--muted, #888)', textTransform: 'uppercase' }}>
                            {kindBadge(hit.kind)}
                          </span>
                          <span style={{ fontWeight: 600 }}>{hit.label}</span>
                          {hit.isFuzzy ? (
                            <span style={{ marginLeft: 'auto', color: '#d97706', fontSize: '0.65rem' }}>fuzzy</span>
                          ) : null}
                        </div>
                        <div style={{ marginTop: 2, fontSize: '0.72rem', color: 'var(--muted, #888)' }}>
                          {hit.subtitle}
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : null}
          </div>

          {/* Export — exports the exact on-screen table (respecting current
              department, month, entity). Available to any role that can see
              the page (admin + budget_viewer). */}
          <button
            className="btn-secondary"
            onClick={handleExport}
            disabled={!overviewReport}
            title={overviewReport ? 'Download the current view as .xlsx' : 'Nothing to export yet'}
          >
            Export
          </button>

          {canOpenQbConnect ? (
            <button className="btn-secondary budget-import-trigger budget-admin-only" onClick={() => setIsQbModalOpen(true)}>
              QuickBooks
            </button>
          ) : null}
          {canImportPlan ? (
            <button className="btn-primary budget-import-trigger budget-admin-only" onClick={openImportModal}>
              Import v1 Workbook
            </button>
          ) : null}
        </div>
      </div>

      {lastActionMessage ? (
        <div className="status-bar budget-plan-status">
          <span className="status-dot ok" />
          <span className="status-text">{lastActionMessage}</span>
        </div>
      ) : null}

      {visibleBudgetTabs.length > 1 && (
        <div className="tab-bar budget-tab-bar">
          {visibleBudgetTabs.map(t => (
            <button key={t.key} className={`tab-btn budget-tab-btn${activeTab === t.key ? ' active' : ''}${t.key !== 'overview' ? ' budget-admin-only' : ''}`} onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'coverage' || activeTab === 'headcount') && (
        <div className="budget-shell">
          <BudgetScopeControls
            year={budgetYear}
            value={budgetView}
            department={activeDept}
            departments={departmentOptions}
            onChange={setBudgetView}
            onYearChange={(year) => setBudgetYear(normalizeBudgetYear(year))}
            onDepartmentChange={setActiveDept}
            showDepartmentSelector={
              activeTab === 'overview' && departmentOptions.length > 1 && (isDepartmentScopedOverview || access?.role === 'admin')
            }
            showEntitySelector={access?.role === 'admin'}
            availableModes={allowedBudgetViewModes ?? undefined}
            availableMonthIndices={selectableMonthIndices}
            allowedEntities={allowedBudgetEntities}
          />
        </div>
      )}

      {qbNotice ? (
        <div className="status-bar budget-plan-status">
          <span className={`status-dot ${qbNotice.tone}`} />
          <span className="status-text">{qbNotice.text}</span>
        </div>
      ) : null}

      {budgetError ? (
        <div className="status-bar budget-plan-status">
          <span className="status-dot warn" />
          <span className="status-text">{budgetError}</span>
        </div>
      ) : null}

      {/* QB connect warning is admin-only — viewers have no UI to act on it
          and don't receive qbStatuses. */}
      {access?.role === 'admin' && !qbStatusLoading && !canFetchOverview && (
        activeTab === 'overview'
        || activeTab === 'headcount'
        || activeTab === 'coverage'
      ) ? (
        <div className="status-bar budget-plan-status">
          <span className="status-dot warn" />
          <span className="status-text">
            Connect QuickBooks for {missingQboEntities.join(', ')} before fetching actuals.
          </span>
        </div>
      ) : null}

      {!loading && budgetState.plan.source !== 'sheet-import' ? (
        <div className={`status-bar budget-plan-status${canImportPlan ? ' status-bar-action' : ''}`}>
          <div className="status-bar-message">
            <span className="status-dot warn" />
            <span className="status-text">
              No imported plan found for {budgetYear} yet. Import one v1 workbook with {BUDGET_DEPTS.length} department tabs to populate Overview and Department.
            </span>
          </div>
          {canImportPlan ? (
            <div className="status-bar-actions budget-admin-only">
              <button className="btn-secondary" onClick={openImportModal}>
                Import v1 Workbook
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && budgetState.plan.source === 'sheet-import' && missingImportedPlanDepartments.length > 0 ? (
        <div className={`status-bar budget-plan-status${canImportPlan ? ' status-bar-action' : ''}`}>
          <div className="status-bar-message">
            <span className="status-dot warn" />
            <span className="status-text">
              Imported plan data is incomplete for {budgetYear}. Missing departments: {formatBudgetDepartmentList(missingImportedPlanDepartments)}.
            </span>
          </div>
          {canImportPlan ? (
            <div className="status-bar-actions budget-admin-only">
              <button className="btn-secondary" onClick={openImportModal}>
                Import Missing Tabs
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading && <div className="status-bar"><span className="status-dot loading" /><span className="status-text">Loading budget data…</span></div>}

      {/* Overview */}
      {activeTab === 'overview' && (
        loading ? (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th><Skeleton width={120} height={10} /></th>
                  <th className="num"><Skeleton width={80} height={10} /></th>
                  <th className="num"><Skeleton width={80} height={10} /></th>
                  <th className="num"><Skeleton width={80} height={10} /></th>
                  <th className="num"><Skeleton width={80} height={10} /></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`overview-skel-${i}`}>
                    <td><Skeleton width={140} height={10} /></td>
                    <td className="num"><Skeleton width={70} height={10} /></td>
                    <td className="num"><Skeleton width={70} height={10} /></td>
                    <td className="num"><Skeleton width={70} height={10} /></td>
                    <td className="num"><Skeleton width={70} height={10} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <BudgetReportTable
            report={overviewReport}
            loadingActuals={activeActualsLoading && !activeActualsLoaded}
            onBudgetCellClick={openBudgetBreakdown}
            onActualCellClick={(row, column) => void openActualDrill(row, column, overviewReport)}
            onRevenueRowClick={() => void openRevenueMonthlyModal()}
          />
        )
      )}

      {/* Headcount */}
      {activeTab === 'headcount' && (
        <>
          <div className="status-bar budget-plan-status">
            <span className="status-dot ok" />
            <span className="status-text">
              Salary and bonus budgets are driven by the Team Tracker roster for {budgetYear}. {headcountActuals ? `QB actuals reflect ${headcountScopeLabel}.` : `Fetch QB compensation actuals for ${headcountScopeLabel} to compare against budget.`}
            </span>
          </div>
          {headcountActualsError ? (
            <div className="status-bar budget-plan-status">
              <span className="status-dot warn" />
              <span className="status-text">{headcountActualsError}</span>
            </div>
          ) : null}
          {headcountActuals?.unclassifiedTotalUsd ? (
            <div className="status-bar budget-plan-status">
              <span className="status-dot warn" />
              <span className="status-text">
                {fmtUSD(headcountActuals.unclassifiedTotalUsd, 0)} of QB compensation actuals could not be classified to a budget department for {headcountScopeLabel}.
              </span>
            </div>
          ) : null}
          {(loading || teamLoading) ? (
            <div className="cards-grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="card">
                  <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
                  <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
                  <Skeleton width={180} height={10} />
                </div>
              ))}
            </div>
          ) : (
          <div className="cards-grid">
            <div className="card">
              <div className="card-label">Active Headcount</div>
              <div className="card-value blue">{headcountSummary.activeHeadcount}</div>
              <div className="card-sub">{headcountTerminatedVisible} terminated kept in audit trail</div>
            </div>
            <div className="card">
              <div className="card-label">Total Salary Budget</div>
              <div className="card-value">{fmtUSD(headcountSummary.totalSalaryBudgetUsd, 0)}</div>
              <div className="card-sub">From Team Tracker</div>
              {headcountActuals ? (
                <div className="card-bar">
                  <div className="card-bar-fill" style={{ width: `${headcountSalaryProgressPct}%` }} />
                </div>
              ) : null}
            </div>
            <div className="card">
              <div className="card-label">Salary Actuals</div>
              <div className="card-value">{headcountActuals ? fmtUSD(headcountSummary.totalSalaryActualUsd, 0) : '—'}</div>
              <div className="card-sub">
                {headcountActuals && headcountSummary.totalSalaryBudgetUsd > 0
                  ? `${((headcountSummary.totalSalaryActualUsd / headcountSummary.totalSalaryBudgetUsd) * 100).toFixed(1)}% of salary budget`
                  : 'Awaiting QuickBooks actuals'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Avg Monthly Burn</div>
              <div className="card-value green">{fmtUSD(headcountSummary.monthlyPayrollBudgetUsd, 0)}</div>
              <div className="card-sub">Salary budget divided across 12 months</div>
            </div>
          </div>
          )}
          <div className="section-header budget-section-header">
            <span className="section-title">Headcount by Department</span>
            <span className="budget-section-note">Active roster only. Click a department row to inspect current team members.</span>
          </div>
          <div className="section" style={{ marginTop: 18 }}>
            <div className="section-header">
              <span className="section-title">Compensation by Department</span>
              <span className="budget-section-note">Budget is roster-driven. Actuals come from mapped QuickBooks salary and bonus accounts.</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="num">Headcount</th>
                    <th className="num">Salary Budget</th>
                    <th className="num">Salary Actual</th>
                    <th className="num">Bonus Budget</th>
                    <th className="num">Bonus Actual</th>
                    <th className="num">Comp Var.</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHeadcountByDepartment.map(({ dept, count, salaryUsd, salaryActualUsd, bonusUsd, bonusActualUsd, compVarianceUsd }) => (
                    <tr key={dept}>
                      <td className="label">
                        <button type="button" className="card-clickable budget-admin-only" onClick={() => setSelectedHeadcountDepartment(dept)}>
                          {getBudgetDepartmentLabel(dept)}
                        </button>
                        <span className="budget-admin-fallback">{getBudgetDepartmentLabel(dept)}</span>
                      </td>
                      <td className="num">{count}</td>
                      <td className="num">{fmtUSD(salaryUsd, 0)}</td>
                      <td className="num">{salaryActualUsd !== 0 ? fmtUSD(salaryActualUsd, 0) : '—'}</td>
                      <td className="num">{fmtUSD(bonusUsd, 0)}</td>
                      <td className="num">{bonusActualUsd !== 0 ? fmtUSD(bonusActualUsd, 0) : '—'}</td>
                      <td className={`num ${getBudgetVarianceTone(compVarianceUsd)}`}>{formatBudgetVariance(compVarianceUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Team roster */}
      {activeTab === 'team' && (
        <div className="budget-admin-only">
          <div className="section-header budget-section-header">
            <span className="section-title">Team Tracker</span>
            <div className="budget-team-header-meta">
              <span className="budget-section-note">{teamSourceLabel}</span>
              <span className="budget-section-note">{teamUpdatedLabel}</span>
            </div>
          </div>
          <div className="tt-toolbar">
            <input className="tt-search" placeholder="Search team…" value={teamSearch} onChange={e => setTeamSearch(e.target.value)} />
            <select className="tt-fsel" value={teamEntityFilter} onChange={e => setTeamEntityFilter(e.target.value)}>
              <option value="">All entities</option>
              {ENTITIES.map(entity => <option key={entity} value={entity}>{entity}</option>)}
            </select>
            <select className="tt-fsel" value={teamDeptFilter} onChange={e => setTeamDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {allowedDepartments.map((d) => <option key={d} value={d}>{getBudgetDepartmentLabel(d)}</option>)}
            </select>
            <select className="tt-fsel" value={teamStatusFilter} onChange={e => setTeamStatusFilter(e.target.value)}>
              <option value="active">Active only</option>
              <option value="">All statuses</option>
              <option value="Terminated">Terminated</option>
            </select>
            {canManageTeam && (
              <button
                className="btn-primary"
                onClick={() => {
                  setEditingMember(null)
                  setIsTeamModalOpen(true)
                }}
              >
                Add Team Member
              </button>
            )}
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--muted)', marginLeft: 'auto' }}>
              {visibleTeam.length} members
            </span>
          </div>

          {(loading || teamLoading) ? (
            <div className="cards-grid budget-team-summary-grid" style={{ marginBottom: 18 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="card">
                  <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
                  <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
                  <Skeleton width={180} height={10} />
                </div>
              ))}
            </div>
          ) : (
          <div className="cards-grid budget-team-summary-grid" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="card-label">{teamSummaryScopeLabel}</div>
              <div className="card-value">{teamSummary.activeMembers}</div>
              <div className="card-sub">{teamSummary.terminatedMembers} terminated · {teamSummary.totalMembers} total records</div>
            </div>
            <div className="card">
              <div className="card-label">Salary Budget</div>
              <div className="card-value">{fmtUSD(teamSummary.totalSalaryUsd, 0)}</div>
            </div>
            <div className="card">
              <div className="card-label">Bonus Budget</div>
              <div className="card-value">{fmtUSD(teamSummary.totalBonusUsd, 0)}</div>
            </div>
            <div className="card">
              <div className="card-label">Total Comp</div>
              <div className="card-value">{fmtUSD(teamSummary.totalCompUsd, 0)}</div>
              <div className="card-sub">Current roster assumptions</div>
            </div>
            <div className="card">
              <div className="card-label">Monthly Payroll Est.</div>
              <div className="card-value">{fmtUSD(teamSummary.monthlyPayrollUsd, 0)}</div>
              <div className="card-sub">Salary budget divided across 12 months</div>
            </div>
          </div>
          )}

          <div className="table-wrap" style={{ maxHeight: '600px', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleTeamSort('name')}>Name{sortIndicator('name')}</th>
                  <th className="sortable" onClick={() => toggleTeamSort('role')}>Role{sortIndicator('role')}</th>
                  <th className="sortable" onClick={() => toggleTeamSort('dept')}>Department{sortIndicator('dept')}</th>
                  <th className="sortable" onClick={() => toggleTeamSort('entity')}>Entity{sortIndicator('entity')}</th>
                  <th className="sortable" onClick={() => toggleTeamSort('location')}>Location{sortIndicator('location')}</th>
                  <th className="sortable" onClick={() => toggleTeamSort('status')}>Status{sortIndicator('status')}</th>
                  <th>Termination Month</th>
                  <th className="num sortable" onClick={() => toggleTeamSort('salary')}>Salary{sortIndicator('salary')}</th>
                  <th className="num sortable" onClick={() => toggleTeamSort('bonus')}>Bonus{sortIndicator('bonus')}</th>
                  <th className="num sortable" onClick={() => toggleTeamSort('totalComp')}>Total Comp{sortIndicator('totalComp')}</th>
                  {canManageTeam && <th className="num">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visibleTeam.length > 0 ? (
                  visibleTeam.map((m: BudgetTeamMember) => (
                    <tr key={m.id} style={m.status === 'Terminated' ? { opacity: 0.55 } : undefined}>
                      <td className="label" style={{ fontWeight: 500 }}>{m.name}</td>
                      <td className="label">{m.role}</td>
                      <td><span className="dept-badge">{getBudgetDepartmentLabel(m.dept)}</span></td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>{m.entity}</td>
                      <td style={{ color: 'var(--muted)' }}>{m.location || '—'}</td>
                      <td><span className={`status-badge ${m.status}`}>{m.status}</span></td>
                      <td style={{ color: 'var(--muted)' }}>{m.terminationMonth || '—'}</td>
                      <td className="num">{fmtUSD(m.salary, 0)}</td>
                      <td className="num">{m.bonus ? fmtUSD(m.bonus, 0) : '—'}</td>
                      <td className="num">{fmtUSD((m.salary || 0) + (m.bonus || 0), 0)}</td>
                      {canManageTeam && (
                        <td className="num">
                          <button
                            className="btn-secondary budget-team-row-btn"
                            onClick={() => {
                              setEditingMember(m)
                              setIsTeamModalOpen(true)
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  )).concat(
                    <tr key="totals" className="budget-team-total-row">
                      <td colSpan={7} className="budget-team-total-label">
                        TOTAL ({visibleTeam.length} shown)
                      </td>
                      <td className="num">{fmtUSD(visibleTeamTotals.salaryUsd, 0)}</td>
                      <td className="num">{fmtUSD(visibleTeamTotals.bonusUsd, 0)}</td>
                      <td className="num">{fmtUSD(visibleTeamTotals.totalCompUsd, 0)}</td>
                      {canManageTeam ? <td aria-hidden="true" /> : null}
                    </tr>,
                  )
                ) : (
                  <tr>
                    <td colSpan={canManageTeam ? 11 : 10}>
                      <div className="empty budget-empty-inline">
                        <div className="empty-icon">∅</div>
                        <div>No team members match the current filters.</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'mapping' && (
        <div className="budget-admin-only">
          <BudgetQbMappingPanel
            mapping={mappingState}
            loading={mappingLoading}
            saving={mappingSaving}
            error={mappingError}
            suggestedAccount={suggestedMappingAccount}
            onSuggestedAccountHandled={() => setSuggestedMappingAccount(null)}
            onSave={saveBudgetMapping}
          />
        </div>
      )}

      {activeTab === 'coverage' && (
        <div className="budget-admin-only">
          <BudgetCoveragePanel
            coverage={coverageState}
            loading={coverageLoading}
            error={coverageError}
            exportHref={coverageExportHref}
            onMapAccount={(accountNumber) => {
              setSuggestedMappingAccount(accountNumber)
              setActiveTab('mapping')
              if (!mappingState && !mappingLoading) {
                void loadBudgetMapping()
              }
            }}
            onExcludeAccount={(accountNumber) => void excludeAccount(accountNumber)}
            onUnExcludeAccount={(accountNumber) => void unExcludeAccount(accountNumber)}
            onUnmapStale={unmapStaleAccount}
            onDrillAccount={(accountNumber, accountName) => void drillCoverageAccount(accountNumber, accountName)}
          />
        </div>
      )}

      <BudgetImportModal
        open={isImportModalOpen && canImportPlan}
        year={budgetYear}
        onClose={() => setIsImportModalOpen(false)}
        onImported={async (result) => {
          await loadBudgetState(true)
          const totalUnmapped = result.results.reduce((sum, entry) => sum + entry.unmappedLineItems.length, 0)
          setLastActionMessage(
            `Imported ${result.succeeded} department${result.succeeded === 1 ? '' : 's'} for ${result.year}` +
              (result.failed > 0 ? ` · ${result.failed} failed` : '') +
              (totalUnmapped > 0 ? ` · ${totalUnmapped} unmapped line item${totalUnmapped === 1 ? '' : 's'}` : ''),
          )
        }}
      />
      <BudgetRecoveryModal
        open={isRecoveryModalOpen && canImportPlan}
        year={budgetYear}
        onClose={() => setIsRecoveryModalOpen(false)}
        onRecovered={async (message) => {
          await loadBudgetState(true)
          setLastActionMessage(message)
        }}
      />
      <BudgetTeamMemberModal
        open={isTeamModalOpen && canManageTeam}
        year={budgetYear}
        member={editingMember}
        defaultDepartment={teamDeptFilter as BudgetDepartment | ''}
        onClose={() => {
          setIsTeamModalOpen(false)
          setEditingMember(null)
        }}
        onSaved={async (result: BudgetTeamMutationResult) => {
          // The mutation API returns the fresh team in result.team — apply it
          // directly so we don't trigger a separate refetch.
          setBudgetState((prev) => ({ ...prev, team: result.team }))
          setTeamLoaded(true)
          const actionLabel =
            result.action === 'create-member'
              ? 'Added'
              : result.action === 'update-member'
                ? 'Updated'
                : result.action === 'terminate-member'
                  ? 'Terminated'
                  : 'Restored'
          setLastActionMessage(`${actionLabel} team member #${result.memberId} for ${budgetYear}.`)
        }}
      />
      <BudgetQbConnectModal
        open={isQbModalOpen}
        statuses={qbStatuses}
        loading={qbStatusLoading}
        canConnect={canOpenQbConnect}
        onClose={() => setIsQbModalOpen(false)}
        onRefresh={() => {
          void loadQbStatus()
        }}
        onConnect={openQbConnect}
      />
      <BudgetHeadcountModal
        open={selectedHeadcountDepartment !== null}
        year={budgetYear}
        department={selectedHeadcountDepartment}
        members={headcountModalMembers}
        onClose={() => setSelectedHeadcountDepartment(null)}
      />
      <BudgetPlanBreakdownModal
        breakdown={planBreakdown}
        onClose={() => setPlanBreakdown(null)}
      />
      <BudgetActualDrillModal
        open={actualDrillOpen}
        title={actualDrillTitle}
        loading={actualDrillLoading}
        error={actualDrillError}
        drill={actualDrill}
        isAdmin={access?.role === 'admin'}
        onClose={() => {
          setActualDrillOpen(false)
          setActualDrill(null)
          setActualDrillError(null)
        }}
      />
      <BudgetRevenueMonthlyModal
        open={revenueModalOpen}
        loading={revenueModalLoading}
        error={revenueModalError}
        breakdown={revenueMonthlyCache[budgetYear] ?? null}
        onClose={() => {
          setRevenueModalOpen(false)
          setRevenueModalError(null)
        }}
      />
    </div>
  )
}
