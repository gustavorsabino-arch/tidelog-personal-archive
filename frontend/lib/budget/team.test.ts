import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getBudgetTeamPlaceholderState,
  restoreBudgetTeamMember,
  terminateBudgetTeamMember,
  upsertBudgetTeamMember,
  validateBudgetTeamMemberInput,
} from './team.ts'

test('creates a new team member with metadata and generated id', () => {
  const state = getBudgetTeamPlaceholderState(2026)
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
  assert.equal(result.memberId, Math.max(...state.members.map((member) => member.id)) + 1)
})

test('updates an existing team member without changing the id', () => {
  const state = getBudgetTeamPlaceholderState(2026)
  const existing = state.members[0]
  const input = validateBudgetTeamMemberInput({
    ...existing,
    role: 'Staff Engineer',
  })

  const result = upsertBudgetTeamMember(state, input, {
    updatedAt: '2026-04-07T12:00:00.000Z',
    updatedBy: 'admin@orca.so',
  }, existing.id)

  assert.equal(result.memberId, existing.id)
  assert.equal(result.state.members.find((member) => member.id === existing.id)?.role, 'Staff Engineer')
})

test('terminates an existing team member without removing them from the file', () => {
  const state = getBudgetTeamPlaceholderState(2026)
  const existing = state.members[0]

  const nextState = terminateBudgetTeamMember(state, existing.id, '04', {
    updatedAt: '2026-04-07T12:00:00.000Z',
    updatedBy: 'admin@orca.so',
  })

  assert.equal(nextState.members.some((member) => member.id === existing.id), true)
  assert.equal(nextState.members.find((member) => member.id === existing.id)?.status, 'Terminated')
  assert.equal(nextState.members.find((member) => member.id === existing.id)?.terminationMonth, '04')
  assert.equal(nextState.lastUpdatedBy, 'admin@orca.so')
})

test('restores a terminated team member back to the active roster', () => {
  const state = getBudgetTeamPlaceholderState(2026)
  const existing = state.members[0]
  const terminated = terminateBudgetTeamMember(state, existing.id, '05', {
    updatedAt: '2026-04-07T12:00:00.000Z',
    updatedBy: 'admin@orca.so',
  })

  const restored = restoreBudgetTeamMember(terminated, existing.id, {
    updatedAt: '2026-04-08T08:00:00.000Z',
    updatedBy: 'admin@orca.so',
  })

  assert.equal(restored.members.find((member) => member.id === existing.id)?.status, 'Current')
  assert.equal(restored.members.find((member) => member.id === existing.id)?.terminationMonth, null)
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
    /Termination month is required/,
  )
})
