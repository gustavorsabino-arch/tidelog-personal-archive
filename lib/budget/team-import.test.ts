import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTeamImportPlan,
  mapMasterRowToInput,
  type TeamImportOp,
  type TeamMasterRow,
} from './team-import.ts'
import type { BudgetTeamMember } from './types.ts'

function row(partial: Partial<TeamMasterRow>): TeamMasterRow {
  return {
    status: 'Current',
    name: 'Person X',
    email: 'x@orca.so',
    entity: 'Opco',
    classification: 'Contractor',
    dept: 'Eng',
    ft: 'FT',
    role: 'Engineer',
    location: 'US - NYC',
    stables: 100000,
    ...partial,
  }
}

function member(partial: Partial<BudgetTeamMember>): BudgetTeamMember {
  return {
    id: 'id-x', name: 'X', dept: 'Engineering', role: 'Eng', salary: 0, bonus: 0,
    entity: 'Opco', classification: 'Contractor', email: '', location: '', ft: 'FT',
    status: 'Current', terminationMonth: null,
    ...partial,
  }
}

test('maps a MASTER row: dept aliases, Stables as salary, bonus cleared', () => {
  const input = mapMasterRowToInput(row({ dept: 'BD', ft: 'PT', stables: 175000 }), '09')
  assert.equal(input.dept, 'Business Development')
  assert.equal(input.ft, 'PT')
  assert.equal(input.salary, 175000)
  assert.equal(input.bonus, 0)
  assert.equal(input.status, 'Current')
  assert.equal(input.terminationMonth, null)
})

test('maps a leave status to Terminated with the given month', () => {
  const input = mapMasterRowToInput(row({ status: 'Voluntary leave' }), '09')
  assert.equal(input.status, 'Terminated')
  assert.equal(input.terminationMonth, '09')
})

test('plan: unmatched rows become adds', () => {
  const { ops } = buildTeamImportPlan([row({ email: 'new@orca.so', name: 'New Person' })], [], '09')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].type, 'add')
  assert.equal(ops[0].input.email, 'new@orca.so')
})

test('plan: matches by email and lists changed fields, preserving the app name', () => {
  const existing = [
    member({ id: 'm-1', name: 'Boosik', email: 'boosik@orca.so', salary: 120000, bonus: 10000, role: 'Developer Advocate', location: 'South Korea' }),
  ]
  const { ops } = buildTeamImportPlan(
    [row({ email: 'boosik@orca.so', name: 'Hyunsik Boo (Boosik)', role: 'Developer Advocate', location: 'South Korea', stables: 130000 })],
    existing,
    '09',
  )
  const update = ops.find(
    (op): op is Extract<TeamImportOp, { type: 'update' }> => op.type === 'update' && op.memberId === 'm-1',
  )
  assert.ok(update)
  assert.equal(update?.input.salary, 130000)
  assert.equal(update?.input.bonus, 0)
  assert.equal(update?.input.name, 'Boosik')
  assert.ok(update?.changes.includes('salary'))
  assert.ok(update?.changes.includes('bonus'))
})

test('plan: unchanged matched members produce no op (idempotent re-run)', () => {
  const existing = [
    member({ id: 'm-2', name: 'Kian G.', email: 'kian@orca.so', salary: 175000, bonus: 0, dept: 'Business Development', ft: 'PT', role: 'Head of BD', entity: 'Zagreus', location: 'US - Texas' }),
  ]
  const { ops } = buildTeamImportPlan(
    [row({ email: 'kian@orca.so', name: 'Kian Ghalibaf (Pangea3 Consulting)', dept: 'BD', ft: 'PT', role: 'Head of BD', entity: 'Zagreus', location: 'US - Texas', stables: 175000 })],
    existing,
    '09',
  )
  assert.equal(ops.some((op) => op.type === 'update'), false)
  assert.equal(ops.some((op) => op.type === 'add'), false)
})

test('plan: matches by normalized name (parentheticals stripped) when email differs', () => {
  const existing = [
    member({ id: 'm-3', name: 'Kian Ghalibaf', email: 'kian@pangea3.com', dept: 'Business Development', ft: 'PT', role: 'Head of BD', entity: 'Zagreus', location: 'US - Texas', salary: 175000 }),
  ]
  const { ops } = buildTeamImportPlan(
    [row({ email: 'kian@orca.so', name: 'Kian Ghalibaf (Pangea3 Consulting)', dept: 'BD', ft: 'PT', role: 'Head of BD', entity: 'Zagreus', location: 'US - Texas', stables: 175000 })],
    existing,
    '09',
  )
  assert.equal(ops.some((op) => op.type === 'add'), false)
})

test('plan: active members missing from the roster are proposed for deactivation (caller may skip)', () => {
  const existing = [
    member({ id: 'm-gone', name: 'Left Person', email: 'left@orca.so', status: 'Current' }),
    member({ id: 'm-term', name: 'Already Terminated', email: 'old@orca.so', status: 'Terminated' }),
  ]
  const { ops } = buildTeamImportPlan([], existing, '09')
  const deact = ops.find((op) => op.type === 'deactivate')
  assert.equal(deact?.memberId, 'm-gone')
  assert.equal(ops.filter((op) => op.type === 'deactivate').length, 1)
})
