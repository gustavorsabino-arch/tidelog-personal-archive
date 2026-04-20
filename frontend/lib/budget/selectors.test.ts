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
import type { BudgetPlanState } from './types.ts'

test('normalizes placeholder data into department totals', () => {
  const state = getBudgetState()
  const totals = getDepartmentTotals(state.plan)
  const engineering = totals.find((entry) => entry.dept === 'Engineering')

  assert.ok(engineering)
  assert.equal(engineering.total, 754211)
  assert.equal(getBudgetSummary(state.plan, state.team.members).annualBudgetUsd, 2898841)
})

test('uses annual lines when present and keeps catalog labels in selectors', () => {
  const state = getBudgetState()
  const lines = getDepartmentAnnualLines(state.plan, 'Engineering')
  const items = getDepartmentLineItems(state.plan, 'Engineering')

  assert.equal(lines.hosting, 480000)
  assert.equal(items[0]?.label, 'Cloud Hosting & Compute')
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
  const state = getBudgetState()
  const plan: BudgetPlanState = {
    ...state.plan,
    departments: {
      ...state.plan.departments,
      Engineering: {
        ...state.plan.departments.Engineering,
        periods: {
          annual: { bonus: -1200, hosting: 480000 },
        },
      },
    },
  }

  const items = getDepartmentLineItems(plan, 'Engineering')
  assert.equal(items.some((item) => item.key === 'bonus' && item.annualBudgetUsd === -1200), true)
})

test('filters team members by search and department', () => {
  const state = getBudgetState()
  const members = filterBudgetTeam(state.team.members, {
    dept: 'Engineering',
    search: 'advocate',
  })

  assert.equal(members.length, 1)
  assert.equal(members[0]?.name, 'Hyunsik Boo (Boosik)')
})

test('filters team members by entity and active status', () => {
  const state = getBudgetState()
  const members = filterBudgetTeam(state.team.members, {
    entity: 'Juku',
    status: 'active',
  })

  assert.ok(members.length > 0)
  assert.equal(members.every((member) => member.entity === 'Juku' && member.status !== 'Terminated'), true)
})

test('sorts team members by total compensation descending', () => {
  const state = getBudgetState()
  const sorted = sortBudgetTeam(state.team.members, 'totalComp', 'desc')

  const firstTotal = (sorted[0]?.salary || 0) + (sorted[0]?.bonus || 0)
  const secondTotal = (sorted[1]?.salary || 0) + (sorted[1]?.bonus || 0)
  assert.ok(firstTotal >= secondTotal)
})

test('builds team summary and headcount totals from active members only', () => {
  const state = getBudgetState()
  const summary = getBudgetTeamSummary(state.team.members)
  const engineering = getHeadcountByDepartment(state.team.members).find((entry) => entry.dept === 'Engineering')

  assert.ok(summary.totalMembers >= summary.activeMembers)
  assert.ok(summary.totalCompUsd >= summary.totalSalaryUsd)
  assert.equal(summary.monthlyPayrollUsd, summary.totalSalaryUsd / 12)
  assert.ok(engineering)
  assert.ok((engineering?.totalCompUsd || 0) >= (engineering?.salaryUsd || 0))
  assert.equal(engineering?.salaryActualUsd, 0)
})

test('supports entity-scoped team summaries and headcount actual overlays', () => {
  const state = getBudgetState()
  const opcoSummary = getBudgetTeamSummary(state.team.members, { entity: 'Opco' })
  const headcount = getHeadcountByDepartment(state.team.members, [
    { dept: 'Engineering', salaryActualUsd: 1000, bonusActualUsd: 200, totalActualUsd: 1200 },
  ])
  const headcountSummary = getBudgetHeadcountSummary(headcount)

  assert.equal(opcoSummary.activeMembers <= opcoSummary.totalMembers, true)
  assert.equal(opcoSummary.monthlyPayrollUsd, opcoSummary.totalSalaryUsd / 12)
  assert.equal(headcount.find((entry) => entry.dept === 'Engineering')?.salaryActualUsd, 1000)
  assert.equal(headcount.find((entry) => entry.dept === 'Engineering')?.compVarianceUsd, 1200 - (headcount.find((entry) => entry.dept === 'Engineering')?.totalCompUsd ?? 0))
  assert.equal(headcountSummary.totalCompActualUsd >= headcountSummary.totalSalaryActualUsd, true)
})
