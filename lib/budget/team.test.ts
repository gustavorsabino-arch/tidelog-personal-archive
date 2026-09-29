import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getBudgetTeamPlaceholderState,
  restoreBudgetTeamMember,
  terminateBudgetTeamMember,
  upsertBudgetTeamMember,
  validateBudgetTeamMemberInput,
} from './team.ts'
import type { BudgetTeamMember, BudgetTeamState } from './types.ts'

function makeMember(overrides: Partial<BudgetTeamMember> = {}): BudgetTeamMember {
  return {
    id: overrides.id ?? 'seed-1',
    name: overrides.name ?? 'Seed Person',
    email: overrides.email ?? 'seed@orca.so',
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

function stateWithMembers(members: BudgetTeamMember[]): BudgetTeamState {
  return { ...getBudgetTeamPlaceholderState(2026), members }
}

test('creates a new team member with metadata and generated id', () => {
  const state = stateWithMembers([])
  const input = validateBudgetTeamMemberInput({
    name: 'Test Person',
    email: 'test@orca.so',
    dept: 'Engineering',
    role: 'Engineer',
    salary: 100000,
    bonus: 5000,
    status: 'Current',
    entity: 'Opco',
    classification: 'Employee',
    location: 'Remote',
    ft: 'FT',
    terminationMonth: null,
  })

  const result = upsertBudgetTeamMember(state, input, {
    updatedAt: '2026-04-07T12:00:00.000Z',
    updatedBy: 'admin@orca.so',
  })

  assert.equal(result.state.source, 'app-managed')
  assert.equal(result.state.lastUpdatedBy, 'admin@orca.so')
  assert.equal(result.state.members.some((member) => member.email === 'test@orca.so'), true)
  assert.equal(typeof result.memberId, 'string')
  assert.equal(result.memberId.length > 0, true)
})

test('updates an existing team member without changing the id', () => {
  const existing = makeMember({ id: 'member-42' })
  const state = stateWithMembers([existing])
  const input = validateBudgetTeamMemberInput({ ...existing, role: 'Staff Engineer' })

  const result = upsertBudgetTeamMember(state, input, {
    updatedAt: '2026-04-07T12:00:00.000Z',
    updatedBy: 'admin@orca.so',
  }, existing.id)

  assert.equal(result.memberId, existing.id)
  assert.equal(result.state.members.find((member) => member.id === existing.id)?.role, 'Staff Engineer')
})

test('terminates an existing team member without removing them from the state', () => {
  const existing = makeMember({ id: 'member-7' })
  const state = stateWithMembers([existing])

  const nextState = terminateBudgetTeamMember(state, existing.id, '04', {
    updatedAt: '2026-04-07T12:00:00.000Z',
    updatedBy: 'admin@orca.so',
  })

  const after = nextState.members.find((member) => member.id === existing.id)
  assert.ok(after)
  assert.equal(after.status, 'Terminated')
  assert.equal(after.terminationMonth, '04')
  assert.equal(nextState.lastUpdatedBy, 'admin@orca.so')
})

test('restores a terminated team member back to the active roster', () => {
  const existing = makeMember({ id: 'member-9' })
  const state = stateWithMembers([existing])
  const terminated = terminateBudgetTeamMember(state, existing.id, '05', {
    updatedAt: '2026-04-07T12:00:00.000Z',
    updatedBy: 'admin@orca.so',
  })

  const restored = restoreBudgetTeamMember(terminated, existing.id, {
    updatedAt: '2026-04-08T08:00:00.000Z',
    updatedBy: 'admin@orca.so',
  })

  const after = restored.members.find((member) => member.id === existing.id)
  assert.equal(after?.status, 'Current')
  assert.equal(after?.terminationMonth, null)
})

test('validates required team member fields', () => {
  assert.throws(
    () => validateBudgetTeamMemberInput({ email: 'missing@orca.so', dept: 'Engineering' }),
    /Name is required/,
  )

  assert.throws(
    () => validateBudgetTeamMemberInput({
      name: 'Former Teammate',
      email: 'former@orca.so',
      dept: 'Engineering',
      role: 'Engineer',
      status: 'Terminated',
    }),
    /Termination date is required/,
  )
})
