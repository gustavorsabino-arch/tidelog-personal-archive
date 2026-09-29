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
const BudgetAdjustModal = dynamic(
  () => import('@/components/budget-adjust-modal').then((m) => m.BudgetAdjustModal),
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
import { mergeBudgetPlanWithCurrentTeam, type BudgetBootstrapResponse } from '@/lib/budget/bootstrap'
import type { BudgetAdjustment } from '@/lib/budget/adjustments-db'
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
import { getClosedBudgetMonthIndices, getAdminSelectableMonthIndices } from '@/lib/budget/scope'
import {
  filterBudgetTeam,
  getBudgetHeadcountSummary,
  getBudgetTeamSummary,
  getHeadcountByDepartment,
  isMemberInMonth,
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
import { buildBudgetWorkbook, buildBudgetExportFilename, buildTransactionsWorkbook } from '@/lib/budget/budget-export'
import {
  buildBudgetSearchIndex,
  searchBudget,
  hasOnlyFuzzyHits,
  filterTransactionsByQuery,
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
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false)
  const [adjustPrefill, setAdjustPrefill] = useState<{ lineItem?: string; department?: string }>({})
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false)
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false)
  const [teamLoadError, setTeamLoadError] = useState<string | null>(null)
  const teamLoadAttemptsRef = useRef(0)
  const [isQbModalOpen, setIsQbModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<BudgetTeamMember | null>(null)
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null)
  const [qbNotice, setQbNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [budgetState, setBudgetState] = useState<BudgetState>(() => createEmptyBudgetState(2026))
  const [adjustments, setAdjustments] = useState<BudgetAdjustment[]>([])
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
  // (Removed: pendingDrillLineKey. Search hits now aggregate into a single
  // modal via openAggregatedSearchModal — no per-hit navigation.)
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
  // Admin path drops the "16th of the month after" wait — as soon as the
  // calendar day flips, the previous month is selectable (and the current
  // month itself is shown for mid-month reviews). Non-admin path keeps
  // getClosedBudgetMonthIndices so budget viewers / contributors only see
  // months whose Actuals are complete.
  const selectableMonthIndices = useMemo(() => {
    const raw = access?.role === 'admin'
      ? getAdminSelectableMonthIndices(budgetYear)
      : getClosedBudgetMonthIndices(budgetYear)
    if (!allowedBudgetMonthIndices || allowedBudgetMonthIndices.length === 0) return raw
    return raw.filter((m) => allowedBudgetMonthIndices.includes(m))
  }, [allowedBudgetMonthIndices, budgetYear, access?.role])

  async function loadBudgetBootstrap(noCache = false) {
    setLoading(true)
    setQbStatusLoading(true)
    setBudgetError(null)

    try {
      const bootstrap = await apiFetch<BudgetBootstrapResponse>(`/api/budget/bootstrap?year=${budgetYear}${noCache ? '&fresh=1' : ''}`)
      setBudgetState((current) => mergeBudgetPlanWithCurrentTeam(current, bootstrap.state))
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
      setBudgetState((current) => mergeBudgetPlanWithCurrentTeam(current, createEmptyBudgetState(budgetYear)))
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
      setBudgetState((current) => mergeBudgetPlanWithCurrentTeam(current, state))
    } catch (error) {
      setBudgetError(error instanceof Error ? error.message : 'Failed to load budget data.')
      setBudgetState((current) => mergeBudgetPlanWithCurrentTeam(current, createEmptyBudgetState(budgetYear)))
    } finally {
      setLoading(false)
    }
  }

  async function loadAdjustments() {
    try {
      const res = await apiFetch<{ adjustments: BudgetAdjustment[] }>(`/api/budget/adjustments?year=${budgetYear}`)
      setAdjustments(res.adjustments ?? [])
    } catch (error) {
      // Non-fatal: the budget page still works without adjustments (e.g. before
      // the migration runs). Log and show the plan as-is.
      console.error('[budget] loadAdjustments failed', error)
      setAdjustments([])
    }
  }

  async function loadBudgetTeam(noCache = false) {
    setTeamLoading(true)
    if (noCache) teamLoadAttemptsRef.current = 0 // manual Retry resets the budget of attempts
    try {
      const team = await apiFetch<BudgetTeamState>(`/api/budget/team?year=${budgetYear}${noCache ? '&fresh=1' : ''}`)
      setBudgetState((prev) => ({ ...prev, team }))
      setTeamLoaded(true)
      setTeamLoadError(null)
      teamLoadAttemptsRef.current = 0
    } catch (error) {
      // Keep whatever roster we already have (never blank it) and surface the
      // failure instead of silently showing an empty table. The intermittent
      // RDS connect timeouts made this look like "sometimes there's no data".
      console.error('[budget] loadBudgetTeam failed', error)
      teamLoadAttemptsRef.current += 1
      setTeamLoadError(error instanceof Error ? error.message : 'request failed')
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
    void loadAdjustments()
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
    // Bounded auto-retry: two attempts, then stop hammering a flaky DB — the
    // Team tab shows a "couldn't load / Retry" bar for a manual re-attempt.
    if (teamLoadAttemptsRef.current >= 2) return
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
  const headcountMonthView = useMemo(() => ({ ...budgetView, mode: 'month' as const }), [budgetView])
  const headcountActualsCacheKey = useMemo(() => getBudgetViewCacheKey(headcountMonthView), [headcountMonthView])
  const overviewActuals = overviewActualsCache[overviewActualsCacheKey] ?? null
  const headcountActuals = headcountActualsCache[headcountActualsCacheKey] ?? null

  const headcountByDepartment = useMemo(() => {
    return getHeadcountByDepartment(budgetState.team.members, headcountActuals?.departments ?? null, {
      year: headcountMonthView.year,
      month: headcountMonthView.month + 1,
      entity: headcountMonthView.entity === 'All' ? undefined : headcountMonthView.entity,
    })
  }, [budgetState.team.members, headcountActuals, headcountMonthView])

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
    headcountCacheKey: headcountActualsCacheKey,
    overviewCacheKey: overviewActualsCacheKey,
    overviewDepartment: overviewSelectedDepartment,
  }), [
    activeDept,
    activeTab,
    departmentActualsCacheKey,
    headcountActualsCacheKey,
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
      const report = buildBudgetDepartmentReport(budgetState.plan, overviewSelectedDepartment, budgetView, adjustments)
      return departmentActuals && departmentActuals.department === overviewSelectedDepartment
        ? applyBudgetDepartmentActuals(report, departmentActuals)
        : report
    }

    const report = buildBudgetOverviewReport(budgetState.plan, BUDGET_DEPTS, budgetView, adjustments)
    return overviewActuals ? applyBudgetOverviewActuals(report, overviewActuals) : report
  }, [budgetState.plan, budgetView, departmentActuals, overviewActuals, overviewSelectedDepartment, adjustments])
  const adjustLineOptions = useMemo(
    () => overviewReport.rows
      .filter((r) => r.kind === 'line' && !!r.budgetKeys && r.budgetKeys.length === 1 && r.key !== 'coreProductRevenue')
      .map((r) => ({ key: r.budgetKeys![0], label: r.label })),
    [overviewReport],
  )
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
        member.dept === selectedHeadcountDepartment
          && (headcountMonthView.entity === 'All' || member.entity === headcountMonthView.entity)
          && isMemberInMonth(member, headcountMonthView.year, headcountMonthView.month + 1)
      )),
      'name',
      'asc',
    )
  }, [budgetState.team.members, selectedHeadcountDepartment, headcountMonthView])
  const headcountScopeLabel = useMemo(
    () => `${headcountMonthView.entity === 'All' ? 'All Entities' : headcountMonthView.entity} · ${getBudgetScopePeriodLabel(headcountMonthView)}`,
    [headcountMonthView],
  )
  const teamSummary = useMemo(() => {
    return getBudgetTeamSummary(
      budgetState.team.members.filter((member) => allowedDepartments.includes(member.dept)),
      { entity: teamEntityFilter || undefined },
    )
  }, [allowedDepartments, budgetState.team.members, teamEntityFilter])
  const headcountSalaryProgressPct = useMemo(() => {
    if (headcountSummary.monthlyPayrollBudgetUsd <= 0 || headcountSummary.totalSalaryActualUsd <= 0) return 0
    return Math.min((headcountSummary.totalSalaryActualUsd / headcountSummary.monthlyPayrollBudgetUsd) * 100, 100)
  }, [headcountSummary.totalSalaryActualUsd, headcountSummary.monthlyPayrollBudgetUsd])
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

  async function openHeadcountSalaryDrill(department: BudgetDepartment) {
    const params = new URLSearchParams({
      year: String(headcountMonthView.year),
      entity: headcountMonthView.entity,
      mode: 'month',
      month: String(headcountMonthView.month),
      rangeStart: String(headcountMonthView.rangeStart),
      rangeEnd: String(headcountMonthView.rangeEnd),
      column: 'period',
      keys: 'salary',
      department,
    })

    setActualDrillTitle(getBudgetActualDrillTitle(`${getBudgetDepartmentLabel(department)} Salary Actual`, headcountMonthView, 'period', ['salary']))
    setActualDrillOpen(true)
    setActualDrillLoading(true)
    setActualDrillError(null)
    setActualDrill(null)

    try {
      setActualDrill(await apiFetch<BudgetActualDrillState>(`/api/budget/actuals/drill?${params.toString()}`))
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
    const cacheKey = headcountActualsCacheKey
    setHeadcountActualsLoading(true)
    setHeadcountActualsError(null)
    if (trigger === 'manual') {
      setQbNotice(null)
    }

    try {
      const params = new URLSearchParams({
        year: String(budgetView.year),
        entity: budgetView.entity,
        mode: 'month',
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

  // Cache key for the search fetch. Deliberately year+entity ONLY — the
  // drill request pulls the whole year for every department the user can
  // see, so changing month / department / tab doesn't invalidate the cache.
  const searchTxCacheKey = useMemo(
    () => `${budgetView.year}:${budgetView.entity}`,
    [budgetView.year, budgetView.entity],
  )

  // Kick off a background fetch of the full-year drilldown as soon as the
  // search box is focused. The fetch spans every allowed department and
  // every month of the year, so a search for 'TRM' in a June view still
  // finds hits in October, and a viewer with access to Legal + BD sees
  // both departments even when the visible table is Legal.
  //
  // Admin: single request, no `department` param (endpoint returns all
  // departments). Viewer: one request per allowed department (endpoint
  // enforces per-dept access). Results are merged into a single synthetic
  // BudgetActualDrillState so the search index sees one unified list.
  useEffect(() => {
    if (!searchOpen) return
    const key = searchTxCacheKey
    if (searchDrillCache[key] !== undefined) return
    if (searchTxAttemptedRef.current.has(key)) return
    searchTxAttemptedRef.current.add(key)

    // Include coreProductRevenue in the keys list so
    // getBudgetActualDrillRange returns the FULL annual range (see
    // lib/budget/drill.ts:67). Without a revenue key it falls back to YTD
    // relative to the view's month, which would exclude months after it.
    const allKeys = [
      'coreProductRevenue',
      'salary', 'benefits', 'payroll', 'severance', 'bonus', 'commissions',
      'epdTools', 'bizTools', 'hosting', 'blockchainRpc', 'securityMon',
      'hrCosts', 'recruiting', 'meals', 'mktExp', 'profSvc', 'corpCompliance',
      'travel', 'colos', 'bankFees', 'rent', 'hardware',
      'corpFees', 'lobbying', 'mmFees', 'industryRelations', 'contingency',
    ]

    const isAdmin = access?.role === 'admin'
    // Admin: [null] → one endpoint call with no department (server returns
    // txns across all depts). Viewer: their allowedDepartments → one call
    // per dept (server checks each).
    const deptTargets: (string | null)[] = isAdmin ? [null] : [...allowedDepartments]

    const paramsBase: Record<string, string> = {
      year: String(budgetView.year),
      entity: budgetView.entity,
      // Use ytd mode w/ Dec so the range covers Jan-Dec for non-revenue
      // keys too; combined with column=annual + revenue in keys list, the
      // server picks annual (Jan-Dec) as the range.
      mode: 'ytd',
      month: '11',
      rangeStart: '0',
      rangeEnd: '11',
      column: 'annual',
      keys: allKeys.join(','),
    }

    setSearchTxLoading(true)
    Promise.all(
      deptTargets.map((dept) => {
        const params = new URLSearchParams(paramsBase)
        if (dept) params.set('department', dept)
        return apiFetch<BudgetActualDrillState>(`/api/budget/actuals/drill?${params.toString()}`)
          .catch((err) => {
            console.warn('[budget/search] drill fetch failed for dept', dept, err)
            return null
          })
      }),
    )
      .then((results) => {
        // Merge every successful drill result into one shape. Transactions
        // are concatenated (each already tagged with normalizedDepartment
        // by the server); accounts are keyed by accountNumber so duplicates
        // across dept fetches collapse to one entry.
        const merged: BudgetActualDrillState | null = (() => {
          const nonNull = results.filter((r): r is BudgetActualDrillState => r !== null)
          if (nonNull.length === 0) return null
          const first = nonNull[0]
          // Dedupe transactions across per-department responses. Kate (Legal
          // + BD) was seeing the same 'Digital Chamber' row twice because
          // the drill endpoint returned it from BOTH dept-scoped calls
          // (accrual accounts are shared across depts). Prefer tx.id as the
          // key (server-issued, always unique); fall back to a synthetic key
          // if id ever comes back empty.
          const seen = new Set<string>()
          const txs: BudgetActualDrillState['transactions'] = []
          for (const r of nonNull) {
            for (const t of (r.transactions ?? [])) {
              const k = t.id || `${t.txnId ?? ''}:${t.accountNumber}:${t.date ?? ''}:${t.amountUsd}`
              if (seen.has(k)) continue
              seen.add(k)
              txs.push(t)
            }
          }
          const accountByNum = new Map<string, typeof first.accounts[number]>()
          for (const r of nonNull) {
            for (const a of r.accounts ?? []) accountByNum.set(a.accountNumber, a)
          }
          return {
            ...first,
            transactions: txs,
            accounts: Array.from(accountByNum.values()),
          }
        })()
        if (!merged) return
        // Defense-in-depth: filter out any transaction whose
        // normalizedDepartment is NOT one the current user is allowed to
        // see. The server should already be doing this per-dept, but a
        // GL account shared across depts occasionally leaks through
        // (e.g. Fireblocks classed to Finance appearing when Legal is
        // the requested scope). This client-side filter is the last
        // gate before the transaction lands in the search cache.
        const finalMerged = isAdmin
          ? merged
          : (() => {
              const allowedSet = new Set(allowedDepartments as string[])
              const filteredTxs = merged.transactions.filter(
                (tx) => tx.normalizedDepartment != null && allowedSet.has(tx.normalizedDepartment),
              )
              const keptAcctNums = new Set(filteredTxs.map((t) => t.accountNumber))
              return {
                ...merged,
                transactions: filteredTxs,
                accounts: merged.accounts.filter((a) => keptAcctNums.has(a.accountNumber)),
              }
            })()
        setSearchDrillCache((prev) => ({ ...prev, [key]: finalMerged }))
      })
      .finally(() => setSearchTxLoading(false))
  }, [searchOpen, searchTxCacheKey, searchDrillCache, budgetView.year, budgetView.entity, access?.role, allowedDepartments])

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

  // Clicking any search hit opens a single aggregated drill modal that
  // shows EVERY transaction matching the current query across all months
  // and all allowed departments -- not just the row the user clicked. This
  // matches Kate's feedback: instead of drilling into one line at a time
  // to see who 'Gustavo' is, the operator sees all Gustavo txns at once.
  //
  // The filter uses the same tolerance ladder as the dropdown ranker
  // (filterTransactionsByQuery in budget-search.ts) so the modal never
  // omits a hit that appeared in the dropdown.
  function openAggregatedSearchModal(query: string) {
    const drill = searchDrill
    const q = query.trim()
    if (!drill || !q) return
    const matched = filterTransactionsByQuery(drill.transactions, q)
    const matchedAcctNums = new Set(matched.map((t) => t.accountNumber))
    const matchedAccounts = drill.accounts.filter((a) => matchedAcctNums.has(a.accountNumber))
    const total = matched.reduce((s, t) => s + t.amountUsd, 0)

    const synthetic: BudgetActualDrillState = {
      ...drill,
      lineKeys: ['__search_aggregate__'],
      totalUsd: total,
      unreconciledTotalUsd: 0,
      accounts: matchedAccounts,
      transactions: matched,
      fetchedAt: new Date().toISOString(),
    }

    setActualDrillTitle(`Search: "${q}" - ${matched.length} match${matched.length === 1 ? '' : 'es'}`)
    setActualDrillOpen(true)
    setActualDrillLoading(false)
    setActualDrillError(null)
    setActualDrill(synthetic)
    setSearchInput('')
    setSearchQuery('')
    setSearchOpen(false)
  }

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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div ref={searchBoxRef} style={{ position: 'relative', minWidth: 240 }}>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search line items, people, txns…"
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
                  right: 0,
                  minWidth: 320,
                  maxWidth: 480,
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
                      ? `Loading transactions for the current view…`
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
                    {/* All-in-one button: opens the aggregated drill modal for
                        every transaction matching the query, across every
                        month and every allowed department. */}
                    <button
                      onClick={() => openAggregatedSearchModal(searchQuery)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        background: 'var(--brand-glow, #f0f7ff)',
                        border: 'none',
                        borderBottom: '1px solid var(--border, #eee)',
                        padding: '10px 12px',
                        cursor: 'pointer',
                        color: 'var(--brand, #2b6cb0)',
                        fontWeight: 600,
                        fontFamily: 'inherit',
                        fontSize: '0.82rem',
                      }}
                    >
                      Open all {searchHits.length} match{searchHits.length === 1 ? '' : 'es'} for "{searchQuery}"
                    </button>
                    {searchHits.map((hit, idx) => (
                      <button
                        key={`${hit.kind}:${hit.label}:${idx}`}
                        role="option"
                        onClick={() => openAggregatedSearchModal(searchQuery)}
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
        </div>
        {(canOpenQbConnect || canImportPlan) ? (
          <div className="budget-page-actions">
          {canOpenQbConnect ? (
            <button className="btn-secondary budget-import-trigger budget-admin-only" onClick={() => setIsQbModalOpen(true)}>
              QuickBooks
            </button>
          ) : null}
          {canImportPlan ? (
            <button className="btn-secondary budget-import-trigger budget-admin-only" onClick={() => { setAdjustPrefill({}); setIsAdjustModalOpen(true) }}>
              Adjust
            </button>
          ) : null}
          {canImportPlan ? (
            <button className="btn-primary budget-import-trigger budget-admin-only" onClick={openImportModal}>
              Import v1 Workbook
            </button>
          ) : null}
          </div>
        ) : null}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
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
            {/* Export sits right next to the Department dropdown per Kate's
                preference. Search lives in the top page-header instead. */}
            <button
              className="btn-secondary"
              onClick={handleExport}
              disabled={!overviewReport}
              title={overviewReport ? 'Download the current view as .xlsx' : 'Nothing to export yet'}
            >
              Export
            </button>
          </div>
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
            onAdjustmentClick={canImportPlan ? (row) => {
              setAdjustPrefill({
                lineItem: row.budgetKeys?.[0],
                department: overviewSelectedDepartment ? String(overviewSelectedDepartment) : undefined,
              })
              setIsAdjustModalOpen(true)
            } : undefined}
          />
        )
      )}

      {/* Headcount */}
      {activeTab === 'headcount' && (
        <>
          <div className="status-bar budget-plan-status">
            <span className="status-dot ok" />
            <span className="status-text">
              Salary budgets are driven by the Team Tracker roster for {budgetYear}. {headcountActuals ? `QB actuals reflect ${headcountScopeLabel}.` : `Fetch QB salary actuals for ${headcountScopeLabel} to compare against the monthly budget.`}
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
          {(loading || teamLoading || (!teamLoaded && !teamLoadError)) ? (
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
              <div className="card-sub">Members with working days in {headcountScopeLabel}</div>
            </div>
            <div className="card">
              <div className="card-label">Salary Budget Yearly</div>
              <div className="card-value">{fmtUSD(headcountSummary.totalSalaryBudgetUsd, 0)}</div>
              <div className="card-sub">2026 salary exposure from Team Tracker</div>
              {headcountActuals ? (
                <div className="card-bar">
                  <div className="card-bar-fill" style={{ width: `${headcountSalaryProgressPct}%` }} />
                </div>
              ) : null}
            </div>
            <div className="card">
              <div className="card-label">Salary Actual · {headcountScopeLabel}</div>
              <div className="card-value">{headcountActuals ? fmtUSD(headcountSummary.totalSalaryActualUsd, 0) : '—'}</div>
              <div className="card-sub">
                {headcountActuals && headcountSummary.monthlyPayrollBudgetUsd > 0
                  ? `${((headcountSummary.totalSalaryActualUsd / headcountSummary.monthlyPayrollBudgetUsd) * 100).toFixed(1)}% of monthly salary budget`
                  : 'Awaiting QuickBooks actuals'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Salary Budget Monthly</div>
              <div className="card-value green">{fmtUSD(headcountSummary.monthlyPayrollBudgetUsd, 0)}</div>
              <div className="card-sub">Working days in {headcountScopeLabel}</div>
            </div>
          </div>
          )}
          <div className="section-header budget-section-header">
            <span className="section-title">Headcount by Department</span>
            <span className="budget-section-note">Members with working days in the selected month. Click a department to inspect them.</span>
          </div>
          <div className="section" style={{ marginTop: 18 }}>
            <div className="section-header">
              <span className="section-title">Compensation by Department</span>
              <span className="budget-section-note">Monthly salary actuals for {headcountScopeLabel}. Click a value for QuickBooks detail.</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="num">Headcount</th>
                    <th className="num">Salary Budget Yearly</th>
                    <th className="num">Salary Budget Monthly</th>
                    <th className="num">Salary Actual</th>
                    <th className="num">Comp Var.</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHeadcountByDepartment.map(({ dept, count, salaryUsd, monthlySalaryBudgetUsd, salaryActualUsd, compVarianceUsd }) => (
                    <tr key={dept}>
                      <td className="label">
                        <button type="button" className="card-clickable budget-admin-only" onClick={() => setSelectedHeadcountDepartment(dept)}>
                          {getBudgetDepartmentLabel(dept)}
                        </button>
                        <span className="budget-admin-fallback">{getBudgetDepartmentLabel(dept)}</span>
                      </td>
                      <td className="num">{count}</td>
                      <td className="num">{fmtUSD(salaryUsd, 0)}</td>
                      <td className="num">{fmtUSD(monthlySalaryBudgetUsd, 0)}</td>
                      <td className="num">{headcountActuals ? (
                        <button type="button" className="budget-table-cell-button" onClick={() => void openHeadcountSalaryDrill(dept)}>
                          {fmtUSD(salaryActualUsd, 0)}
                        </button>
                      ) : '—'}</td>
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

          {teamLoadError && !teamLoading ? (
            <div className="status-bar" style={{ marginBottom: 12 }}>
              <span className="status-dot warn" />
              <span className="status-text">Couldn&apos;t load the team roster ({teamLoadError}).</span>
              <button className="btn-secondary" style={{ marginLeft: 8, fontSize: '0.72rem', padding: '2px 10px' }} onClick={() => void loadBudgetTeam(true)}>
                Retry
              </button>
            </div>
          ) : null}

          {(loading || teamLoading || (!teamLoaded && !teamLoadError)) ? (
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
              <div className="card-label">Salary Budget (Stables)</div>
              <div className="card-value">{fmtUSD(teamSummary.totalSalaryUsd, 0)}</div>
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
                  <th>Last Day</th>
                  <th className="num sortable" onClick={() => toggleTeamSort('salary')}>Salary (Stables){sortIndicator('salary')}</th>
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
                      <td style={{ color: 'var(--muted)' }}>{m.terminationDate || '—'}</td>
                      <td className="num">{fmtUSD(m.salary, 0)}</td>
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
                      {canManageTeam ? <td aria-hidden="true" /> : null}
                    </tr>,
                  )
                ) : (
                  <tr>
                    <td colSpan={canManageTeam ? 9 : 8}>
                      <div className="empty budget-empty-inline">
                        <div className="empty-icon">∅</div>
                        <div>{!teamLoaded && !teamLoadError ? 'Loading team members…' : teamLoadError && !teamLoaded ? 'Team roster could not be loaded. Use Retry above.' : 'No team members match the current filters.'}</div>
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

      <BudgetAdjustModal
        open={isAdjustModalOpen && canImportPlan}
        year={budgetYear}
        departments={BUDGET_DEPTS}
        lineItems={adjustLineOptions}
        existing={adjustments}
        initialLineItem={adjustPrefill.lineItem}
        initialDepartment={adjustPrefill.department}
        onClose={() => setIsAdjustModalOpen(false)}
        onSaved={async () => {
          await loadAdjustments()
          setLastActionMessage('Budget adjustment saved.')
        }}
        onReverse={async (id) => {
          await apiPost(`/api/budget/adjustments/${id}/reverse`, {})
          await loadAdjustments()
          setLastActionMessage('Budget adjustment reversed.')
        }}
      />
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
        month={headcountMonthView.month + 1}
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
        onExport={actualDrill && actualDrill.transactions.length > 0 ? () => {
          // Slug the modal title into a filename. Trims quotes, collapses
          // non-alphanumerics, caps length.
          const slug = actualDrillTitle.toLowerCase()
            .replace(/[""]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'drill'
          const filename = `tidelog-${slug}.xlsx`
          const wb = buildTransactionsWorkbook(actualDrill.transactions, slug.slice(0, 30))
          XLSX.writeFile(wb, filename)
        } : undefined}
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
