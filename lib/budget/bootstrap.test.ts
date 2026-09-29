import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeBudgetPlanWithCurrentTeam } from './bootstrap.ts'
import type { BudgetPlanState, BudgetState, BudgetTeamMember } from './types.ts'

test('a late bootstrap response keeps a roster already loaded for the same year', () => {
  const placeholder = {
    version: 1 as const,
    year: 2026,
    members: [],
    source: 'placeholder-static' as const,
    lastUpdatedAt: null,
    lastUpdatedBy: null,
  }
  const member = { id: 'member-1', name: 'Team member' } as BudgetTeamMember
  const currentPlan = { year: 2026, version: 1, departments: {}, source: 'placeholder-static', lastUpdatedAt: null } as BudgetPlanState
  const bootstrapPlan = { ...currentPlan, source: 'sheet-import' as const }
  const current: BudgetState = {
    plan: currentPlan,
    team: { ...placeholder, members: [member], source: 'app-managed' },
  }
  const bootstrap: BudgetState = { plan: bootstrapPlan, team: placeholder }

  const merged = mergeBudgetPlanWithCurrentTeam(current, bootstrap)
  assert.equal(merged.plan, bootstrap.plan)
  assert.equal(merged.team, current.team)
  assert.equal(merged.team.members.length, 1)

  const nextYear = { ...bootstrap, team: { ...placeholder, year: 2027 } }
  assert.equal(mergeBudgetPlanWithCurrentTeam(current, nextYear).team, nextYear.team)
})
