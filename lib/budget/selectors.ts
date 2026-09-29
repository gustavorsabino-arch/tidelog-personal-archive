import { BUDGET_DEPTS } from '../constants.ts'
import {
  BUDGET_LINE_CATALOG,
  BUDGET_LINE_ENTRY_BY_KEY,
  normalizeBudgetLineAmounts,
  type BudgetLineKey,
} from './catalog.ts'
import type {
  BudgetDepartment,
  BudgetDepartmentLineItem,
  BudgetDepartmentTotal,
  BudgetHeadcountActualEntry,
  BudgetHeadcountByDepartment,
  BudgetHeadcountSummary,
  BudgetLineAmounts,
  BudgetPlanState,
  BudgetSummary,
  BudgetTeamMember,
  BudgetTeamSummary,
} from './types.ts'

const EMPTY_LINES: BudgetLineAmounts = {}

function sumLineAmounts(lines: BudgetLineAmounts): number {
  return Object.values(lines).reduce((sum, value) => sum + (value ?? 0), 0)
}

function humanizeBudgetLineKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function sumMonthlyPeriods(plan: BudgetPlanState, department: BudgetDepartment): BudgetLineAmounts {
  const periods = plan.departments[department]?.periods ?? {}
  const totals: BudgetLineAmounts = {}

  for (const [period, lines] of Object.entries(periods)) {
    if (period === 'annual' || !lines) continue
    for (const [key, value] of Object.entries(normalizeBudgetLineAmounts(lines))) {
      totals[key as BudgetLineKey] = (totals[key as BudgetLineKey] ?? 0) + (value ?? 0)
    }
  }

  return totals
}

export function getDepartmentAnnualLines(plan: BudgetPlanState, department: BudgetDepartment): BudgetLineAmounts {
  const annualLines = plan.departments[department]?.periods.annual
  if (annualLines) return normalizeBudgetLineAmounts(annualLines)
  return sumMonthlyPeriods(plan, department)
}

export function getDepartmentTotals(plan: BudgetPlanState): BudgetDepartmentTotal[] {
  return BUDGET_DEPTS.map((dept) => {
    const lines = getDepartmentAnnualLines(plan, dept)
    return {
      dept,
      total: sumLineAmounts(lines),
      lines,
    }
  })
}

export function getGrandTotal(plan: BudgetPlanState): number {
  return getDepartmentTotals(plan).reduce((sum, department) => sum + department.total, 0)
}

export function getActiveTeamMembers(members: BudgetTeamMember[]): BudgetTeamMember[] {
  return members.filter((member) => member.status !== 'Terminated')
}

export function getBudgetSummary(plan: BudgetPlanState, members: BudgetTeamMember[]): BudgetSummary {
  const activeTeam = getActiveTeamMembers(members)
  const totalSalaryUsd = activeTeam.reduce((sum, member) => sum + (member.salary || 0), 0)
  const totalBonusUsd = activeTeam.reduce((sum, member) => sum + (member.bonus || 0), 0)
  const annualBudgetUsd = getGrandTotal(plan)

  return {
    annualBudgetUsd,
    monthlyAverageUsd: annualBudgetUsd / 12,
    activeHeadcount: activeTeam.length,
    terminatedHeadcount: members.length - activeTeam.length,
    totalCompUsd: totalSalaryUsd + totalBonusUsd,
  }
}

function buildHeadcountActualMap(
  actuals: readonly BudgetHeadcountActualEntry[] | null | undefined,
): Record<string, BudgetHeadcountActualEntry> {
  return Object.fromEntries(
    (actuals ?? []).map((entry) => [entry.dept, entry]),
  )
}

function weekdaysInclusive(start: Date, end: Date): number {
  let days = 0
  for (let time = start.getTime(); time <= end.getTime(); time += 86_400_000) {
    const day = new Date(time).getUTCDay()
    if (day !== 0 && day !== 6) days++
  }
  return days
}

export function getMemberMonthlySalaryBudget(member: BudgetTeamMember, year: number, month: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const last = new Date(Date.UTC(year, month, 0))
  const start = member.startDate ? new Date(`${member.startDate}T00:00:00Z`) : first
  const legacyEnd = member.status === 'Terminated' && member.terminationMonth
    ? new Date(Date.UTC(year, Number(member.terminationMonth), 0)) : last
  const end = member.terminationDate ? new Date(`${member.terminationDate}T00:00:00Z`) : legacyEnd
  if (start > last || end < first || start > end) return 0
  const worked = weekdaysInclusive(start > first ? start : first, end < last ? end : last)
  return (member.salary || 0) / 12 * worked / weekdaysInclusive(first, last)
}

export function isMemberInMonth(member: BudgetTeamMember, year: number, month: number): boolean {
  return getMemberMonthlySalaryBudget({ ...member, salary: 12 }, year, month) > 0
}

export function getHeadcountByDepartment(
  members: BudgetTeamMember[],
  actuals: readonly BudgetHeadcountActualEntry[] | null = null,
  scope?: { year: number; month: number; entity?: string },
): BudgetHeadcountByDepartment[] {
  const actualByDepartment = buildHeadcountActualMap(actuals)

  return BUDGET_DEPTS.map((dept) => {
    const deptMembers = members.filter((member) => member.dept === dept && (!scope?.entity || member.entity === scope.entity))
    const activeMembers = scope
      ? deptMembers.filter((member) => isMemberInMonth(member, scope.year, scope.month))
      : deptMembers.filter((member) => member.status !== 'Terminated')
    const salaryUsd = scope
      ? deptMembers.reduce((sum, member) => sum + Array.from({ length: 12 }, (_, index) => getMemberMonthlySalaryBudget(member, scope.year, index + 1)).reduce((a, b) => a + b, 0), 0)
      : activeMembers.reduce((sum, member) => sum + (member.salary || 0), 0)
    const monthlySalaryBudgetUsd = scope
      ? deptMembers.reduce((sum, member) => sum + getMemberMonthlySalaryBudget(member, scope.year, scope.month), 0)
      : salaryUsd / 12
    const bonusUsd = activeMembers.reduce((sum, member) => sum + (member.bonus || 0), 0)
    const totalCompUsd = salaryUsd + bonusUsd
    const actualEntry = actualByDepartment[dept]
    const totalActualUsd = actualEntry?.totalActualUsd ?? ((actualEntry?.salaryActualUsd ?? 0) + (actualEntry?.bonusActualUsd ?? 0))

    return {
      dept,
      count: activeMembers.length,
      terminatedCount: deptMembers.length - activeMembers.length,
      salaryUsd,
      monthlySalaryBudgetUsd,
      bonusUsd,
      totalCompUsd,
      salaryActualUsd: actualEntry?.salaryActualUsd ?? 0,
      bonusActualUsd: actualEntry?.bonusActualUsd ?? 0,
      totalActualUsd,
      compVarianceUsd: actuals !== null ? (actualEntry?.salaryActualUsd ?? 0) - monthlySalaryBudgetUsd : null,
    }
  })
}

export function getBudgetHeadcountSummary(rows: readonly BudgetHeadcountByDepartment[]): BudgetHeadcountSummary {
  return rows.reduce<BudgetHeadcountSummary>((summary, row) => ({
    activeHeadcount: summary.activeHeadcount + row.count,
    totalSalaryBudgetUsd: summary.totalSalaryBudgetUsd + row.salaryUsd,
    totalSalaryActualUsd: summary.totalSalaryActualUsd + row.salaryActualUsd,
    totalBonusBudgetUsd: summary.totalBonusBudgetUsd + row.bonusUsd,
    totalBonusActualUsd: summary.totalBonusActualUsd + row.bonusActualUsd,
    totalCompBudgetUsd: summary.totalCompBudgetUsd + row.totalCompUsd,
    totalCompActualUsd: summary.totalCompActualUsd + row.totalActualUsd,
    monthlyPayrollBudgetUsd: summary.monthlyPayrollBudgetUsd + row.monthlySalaryBudgetUsd,
  }), {
    activeHeadcount: 0,
    totalSalaryBudgetUsd: 0,
    totalSalaryActualUsd: 0,
    totalBonusBudgetUsd: 0,
    totalBonusActualUsd: 0,
    totalCompBudgetUsd: 0,
    totalCompActualUsd: 0,
    monthlyPayrollBudgetUsd: 0,
  })
}

export function filterBudgetTeam(
  members: BudgetTeamMember[],
  options: { search?: string; dept?: string; entity?: string; status?: string },
): BudgetTeamMember[] {
  const search = options.search?.trim().toLowerCase() ?? ''
  const dept = options.dept ?? ''
  const entity = options.entity ?? ''
  const status = options.status ?? 'active'

  return members.filter((member) => {
    if (dept && member.dept !== dept) return false
    if (entity && member.entity !== entity) return false
    if (status === 'active' && member.status === 'Terminated') return false
    if (status && status !== 'active' && member.status !== status) return false
    if (!search) return true

    return [member.name, member.role, member.dept, member.entity, member.location].some((value) =>
      value.toLowerCase().includes(search),
    )
  })
}

export function getBudgetTeamSummary(
  members: BudgetTeamMember[],
  options: { entity?: string } = {},
): BudgetTeamSummary {
  const scopedMembers = options.entity
    ? members.filter((member) => member.entity === options.entity)
    : members
  const activeMembers = getActiveTeamMembers(scopedMembers)
  const totalSalaryUsd = activeMembers.reduce((sum, member) => sum + (member.salary || 0), 0)
  const totalBonusUsd = activeMembers.reduce((sum, member) => sum + (member.bonus || 0), 0)

  return {
    totalMembers: scopedMembers.length,
    activeMembers: activeMembers.length,
    terminatedMembers: scopedMembers.length - activeMembers.length,
    totalSalaryUsd,
    totalBonusUsd,
    totalCompUsd: totalSalaryUsd + totalBonusUsd,
    monthlyPayrollUsd: totalSalaryUsd / 12,
  }
}

export type BudgetTeamSortKey =
  | 'name'
  | 'role'
  | 'dept'
  | 'entity'
  | 'location'
  | 'status'
  | 'salary'
  | 'bonus'
  | 'totalComp'

function getBudgetTeamSortValue(member: BudgetTeamMember, key: BudgetTeamSortKey): string | number {
  switch (key) {
    case 'salary':
      return member.salary || 0
    case 'bonus':
      return member.bonus || 0
    case 'totalComp':
      return (member.salary || 0) + (member.bonus || 0)
    case 'name':
    case 'role':
    case 'dept':
    case 'entity':
    case 'location':
    case 'status':
      return member[key] || ''
    default:
      return ''
  }
}

export function sortBudgetTeam(
  members: BudgetTeamMember[],
  sortKey: BudgetTeamSortKey,
  direction: 'asc' | 'desc' = 'asc',
): BudgetTeamMember[] {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...members].sort((left, right) => {
    const leftValue = getBudgetTeamSortValue(left, sortKey)
    const rightValue = getBudgetTeamSortValue(right, sortKey)

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * multiplier
    }

    return String(leftValue).localeCompare(String(rightValue)) * multiplier
  })
}

export function getDepartmentLineItems(
  plan: BudgetPlanState,
  department: BudgetDepartment,
): BudgetDepartmentLineItem[] {
  const lines = getDepartmentAnnualLines(plan, department)
  const deptTotal = sumLineAmounts(lines)
  const orderedKeys = new Set<string>(BUDGET_LINE_CATALOG.map((entry) => entry.key))

  const keys = [
    ...BUDGET_LINE_CATALOG.map((entry) => entry.key),
    ...Object.keys(lines).filter((key) => !orderedKeys.has(key)),
  ]

  return keys
    .map((key) => {
      const annualBudgetUsd = lines[key as BudgetLineKey] ?? 0
      if (annualBudgetUsd === 0) return null

      const metadata = BUDGET_LINE_ENTRY_BY_KEY[key] ?? {
        key,
        label: humanizeBudgetLineKey(key),
        category: 'Other',
      }

      const item: BudgetDepartmentLineItem = {
        key: key as BudgetLineKey,
        label: String(metadata.label),
        category: String(metadata.category),
        annualBudgetUsd,
        monthlyBudgetUsd: annualBudgetUsd / 12,
        sharePct: deptTotal > 0 ? (annualBudgetUsd / deptTotal) * 100 : 0,
      }

      return item
    })
    .filter((item): item is BudgetDepartmentLineItem => item !== null)
    .sort((a, b) => b.annualBudgetUsd - a.annualBudgetUsd)
}

export function getDepartmentTotal(plan: BudgetPlanState, department: BudgetDepartment): number {
  return sumLineAmounts(getDepartmentAnnualLines(plan, department))
}

export function getDepartmentLinesOrEmpty(
  plan: BudgetPlanState,
  department: BudgetDepartment | '',
): BudgetLineAmounts {
  if (!department) return EMPTY_LINES
  return getDepartmentAnnualLines(plan, department)
}
