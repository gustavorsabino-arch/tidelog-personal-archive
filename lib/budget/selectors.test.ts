import test from 'node:test'
import assert from 'node:assert/strict'

import { getBudgetState } from './source.ts'
import {
  filterBudgetTeam,
  getBudgetHeadcountSummary,
  getBudgetSummary,
  getBudgetTeamSummary,
  getDepartmentAnnualLines,
  getDepartmentLineItems,
  getDepartmentTotals,
  getHeadcountByDepartment,
  sortBudgetTeam,
} from './selectors.ts'
import type { BudgetPlanState, BudgetTeamMember } from './types.ts'

function makeMember(overrides: Partial<BudgetTeamMember> = {}): BudgetTeamMember {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'Test Person',
    email: overrides.email ?? 'test@orca.so',
    dept: overrides.dept ?? 'Engineering',
    role: overrides.role ?? 'Engineer',
    salary: overrides.salary ?? 120000,
    bonus: overrides.bonus ?? 10000,
    status: overrides.status ?? 'Current',
    entity: overrides.entity ?? 'Opco',
    classification: overrides.classification ?? 'Employee',
    location: overrides.location ?? 'Remote',
    ft: overrides.ft ?? 'FT',
    terminationMonth: overrides.terminationMonth ?? null,
  }
}

function planWithEngineeringLines(lines: Record<string, number>): BudgetPlanState {
  const base = getBudgetState().plan
  return {
    ...base,
    departments: {
      ...base.departments,
      Engineering: {
        ...base.departments.Engineering,
        periods: { annual: lines },
      },
    },
  }
}

test('computes department totals from the annual lines in a plan', () => {
  const plan = planWithEngineeringLines({ hosting: 480000, salary: 300000 })
  const totals = getDepartmentTotals(plan)
  const engineering = totals.find((entry) => entry.dept === 'Engineering')

  assert.ok(engineering)
  assert.equal(engineering.total, 780000)
  assert.equal(getBudgetSummary(plan, []).annualBudgetUsd, 780000)
})

test('uses annual lines when present and keeps catalog labels in selectors', () => {
  const plan = planWithEngineeringLines({ hosting: 480000, salary: 300000 })
  const lines = getDepartmentAnnualLines(plan, 'Engineering')
  const items = getDepartmentLineItems(plan, 'Engineering')

  assert.equal(lines.hosting, 480000)
  const hosting = items.find((item) => item.key === 'hosting')
  assert.equal(hosting?.label, 'Cloud Hosting & Compute')
})

test('falls back to summed monthly periods when annual data is missing', () => {
  const state = getBudgetState()
  const plan: BudgetPlanState = {
    ...state.plan,
    departments: {
      ...state.plan.departments,
      Engineering: {
        ...state.plan.departments.Engineering,
        periods: {
          '01': { hosting: 100, travel: 25 },
          '02': { hosting: 50 },
        },
      },
    },
  }

  const annualLines = getDepartmentAnnualLines(plan, 'Engineering')
  assert.equal(annualLines.hosting, 150)
  assert.equal(annualLines.travel, 25)
})

test('keeps negative annual line items visible in department selectors', () => {
  const plan = planWithEngineeringLines({ bonus: -1200, hosting: 480000 })
  const items = getDepartmentLineItems(plan, 'Engineering')
  assert.equal(items.some((item) => item.key === 'bonus' && item.annualBudgetUsd === -1200), true)
})

test('filters team members by search and department', () => {
  const members = [
    makeMember({ name: 'Developer Advocate', dept: 'Engineering' }),
    makeMember({ name: 'Product Manager', dept: 'Product' }),
    makeMember({ name: 'Backend Engineer', dept: 'Engineering' }),
  ]
  const filtered = filterBudgetTeam(members, { dept: 'Engineering', search: 'advocate' })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]?.name, 'Developer Advocate')
})

test('filters team members by entity and active status', () => {
  const members = [
    makeMember({ entity: 'Juku', status: 'Current' }),
    makeMember({ entity: 'Juku', status: 'Terminated', terminationMonth: '04' }),
    makeMember({ entity: 'Opco', status: 'Current' }),
  ]
  const filtered = filterBudgetTeam(members, { entity: 'Juku', status: 'active' })
  assert.ok(filtered.length > 0)
  assert.equal(filtered.every((member) => member.entity === 'Juku' && member.status !== 'Terminated'), true)
})

test('sorts team members by total compensation descending', () => {
  const members = [
    makeMember({ salary: 100000, bonus: 5000 }),
    makeMember({ salary: 200000, bonus: 20000 }),
    makeMember({ salary: 150000, bonus: 10000 }),
  ]
  const sorted = sortBudgetTeam(members, 'totalComp', 'desc')
  const firstTotal = (sorted[0]?.salary || 0) + (sorted[0]?.bonus || 0)
  const secondTotal = (sorted[1]?.salary || 0) + (sorted[1]?.bonus || 0)
  assert.ok(firstTotal >= secondTotal)
})

test('builds team summary and headcount totals from active members only', () => {
  const members = [
    makeMember({ name: 'A', salary: 100000, bonus: 5000 }),
    makeMember({ name: 'B', status: 'Terminated', terminationMonth: '04' }),
  ]
  const summary = getBudgetTeamSummary(members)
  const engineering = getHeadcountByDepartment(members).find((entry) => entry.dept === 'Engineering')

  assert.ok(summary.totalMembers >= summary.activeMembers)
  assert.ok(summary.totalCompUsd >= summary.totalSalaryUsd)
  assert.equal(summary.monthlyPayrollUsd, summary.totalSalaryUsd / 12)
  assert.ok(engineering)
  assert.ok((engineering?.totalCompUsd || 0) >= (engineering?.salaryUsd || 0))
  assert.equal(engineering?.salaryActualUsd, 0)
})

test('supports entity-scoped team summaries and headcount actual overlays', () => {
  const members = [
    makeMember({ entity: 'Opco', salary: 100000 }),
    makeMember({ entity: 'Juku', salary: 200000 }),
  ]
  const opcoSummary = getBudgetTeamSummary(members, { entity: 'Opco' })
  const headcount = getHeadcountByDepartment(members, [
    { dept: 'Engineering', salaryActualUsd: 1000, bonusActualUsd: 200, totalActualUsd: 1200 },
  ])
  const headcountSummary = getBudgetHeadcountSummary(headcount)

  assert.equal(opcoSummary.activeMembers <= opcoSummary.totalMembers, true)
  assert.equal(opcoSummary.monthlyPayrollUsd, opcoSummary.totalSalaryUsd / 12)
  assert.equal(headcount.find((entry) => entry.dept === 'Engineering')?.salaryActualUsd, 1000)
  const engineeringEntry = headcount.find((entry) => entry.dept === 'Engineering')
  assert.equal(engineeringEntry?.compVarianceUsd, 1000 - (engineeringEntry?.salaryUsd ?? 0) / 12)
  assert.equal(headcount.find((entry) => entry.dept !== 'Engineering')?.compVarianceUsd, 0)
  assert.equal(headcountSummary.totalCompActualUsd >= headcountSummary.totalSalaryActualUsd, true)
})
