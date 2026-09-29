import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'

import {
  parseTeamMasterWorkbook,
  buildTeamImportPlan,
  type TeamImportOp,
} from './team-import.ts'
import type { BudgetTeamMember } from './types.ts'

// Mirrors the real "Team Tracker - MASTER" layout: title rows, header on row 3,
// the current-team block numbered 1..N, then a second section whose numbering
// restarts (advisors/terminated) that must NOT be imported.
function masterSheetRows(): unknown[][] {
  return [
    ['TEAM TRACKER MASTER SHEET - to archive.'],
    ['Employee'],
    ['Current', 'Status', 'Name', 'ORCA Email', 'Email', 'Entity', 'Classification', 'Department/Class', 'Reporting To', 'PT/FT', 'Start Date', 'Role', 'Location', 'W Form', 'WFX or ICHRA?', 'Stables'],
    [1, 'Voluntary leave', 'Bella Basuni (Basuni LLC)', 'bella@orca.so', 'personal@x.com', 'Zagreus', 'Contractor', 'Ops', 'Isaac', 'FT', 44564, 'Operations Lead', 'US - Georgia', '', '', 150000],
    [2, 'Current', 'Boosik Hyunsik', 'boosik@orca.so', '', 'Opco', 'Contractor', 'Eng', 'Luke', 'FT', 44564, 'Developer Advocate', 'South Korea', '', '', 130000],
    [3, 'Current', 'Kian Ghalibaf (Pangea3 Consulting)', 'kian@orca.so', '', 'Zagreus', 'Contractor', 'BD', 'Luke', 'PT', 44564, 'Head of BD', 'US - Texas', '', '', 175000],
    ['Advisors'],
    [1, 'Advisor', 'Grace Kwan', 'ori@orca.so', '', 'Zagreus', 'Contractor', 'Product', '', 'PT', 44564, 'Board advisor', '', '', '', 70000],
    [2, 'Terminated', 'Old Person', '', '', '', '', 'Eng', '', 'FT', 44564, '', '', '', '', 50000],
  ]
}

function buildWorkbookBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(masterSheetRows()), 'Total Comp Tracker')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

function member(partial: Partial<BudgetTeamMember>): BudgetTeamMember {
  return {
    id: 'id-x', name: 'X', dept: 'Engineering', role: 'Eng', salary: 0, bonus: 0,
    entity: 'Opco', classification: 'Contractor', email: '', location: '', ft: 'FT',
    status: 'Current', terminationMonth: null,
    ...partial,
  }
}

test('parses only the first numbered block and maps the master columns', () => {
  const rows = parseTeamMasterWorkbook(buildWorkbookBuffer())
  assert.equal(rows.length, 3) // stops before the Advisors block (numbering restarts)
  assert.deepEqual(rows.map((r) => r.num), [1, 2, 3])
  assert.equal(rows[0].name, 'Bella Basuni (Basuni LLC)')
  assert.equal(rows[0].status, 'Voluntary leave')
  assert.equal(rows[0].stables, 150000)
  assert.equal(rows[1].email, 'boosik@orca.so')
  assert.equal(rows[2].ft, 'PT')
})

test('plan: adds new people with dept mapping, Stables as salary, bonus cleared', () => {
  const rows = parseTeamMasterWorkbook(buildWorkbookBuffer())
  const { ops } = buildTeamImportPlan(rows, [], '09')
  const add = ops.find((op) => op.type === 'add' && op.input.email === 'boosik@orca.so')
  assert.ok(add)
  assert.equal(add?.input.dept, 'Engineering') // 'Eng' mapped
  assert.equal(add?.input.salary, 130000)
  assert.equal(add?.input.bonus, 0)
  assert.equal(add?.input.status, 'Current')
  const bd = ops.find((op) => op.type === 'add' && op.input.email === 'kian@orca.so')
  assert.equal(bd?.input.dept, 'Business Development') // 'BD' mapped
  assert.equal(bd?.input.ft, 'PT')
})

test('plan: file rows with a leave status become Terminated with the given month', () => {
  const rows = parseTeamMasterWorkbook(buildWorkbookBuffer())
  const { ops } = buildTeamImportPlan(rows, [], '09')
  const bella = ops.find((op) => op.input.email === 'bella@orca.so')
  assert.equal(bella?.input.status, 'Terminated')
  assert.equal(bella?.input.terminationMonth, '09')
})

test('plan: matches existing members by email and lists the changed fields', () => {
  const rows = parseTeamMasterWorkbook(buildWorkbookBuffer())
  const existing = [
    member({ id: 'm-boosik', name: 'Boosik', email: 'boosik@orca.so', salary: 120000, bonus: 10000, dept: 'Engineering', ft: 'FT', role: 'Developer Advocate', entity: 'Opco', classification: 'Contractor', location: 'South Korea' }),
  ]
  const { ops } = buildTeamImportPlan(rows, existing, '09')
  const update = ops.find(
    (op): op is Extract<TeamImportOp, { type: 'update' }> => op.type === 'update' && op.memberId === 'm-boosik',
  )
  assert.ok(update)
  assert.equal(update?.input.salary, 130000)
  assert.equal(update?.input.bonus, 0)
  assert.equal(update?.input.name, 'Boosik') // existing name preserved
  assert.ok(update?.changes.includes('salary'))
  assert.ok(update?.changes.includes('bonus'))
})

test('plan: unchanged matched members produce no op', () => {
  const rows = parseTeamMasterWorkbook(buildWorkbookBuffer())
  const existing = [
    member({ id: 'm-kian', name: 'Kian G.', email: 'kian@orca.so', salary: 175000, bonus: 0, dept: 'Business Development', ft: 'PT', role: 'Head of BD', entity: 'Zagreus', classification: 'Contractor', location: 'US - Texas' }),
  ]
  const { ops } = buildTeamImportPlan(rows, existing, '09')
  assert.equal(ops.some((op) => op.type === 'update' && op.memberId === 'm-kian'), false)
})

test('plan: matches by normalized name (parentheticals stripped) when email differs', () => {
  const rows = parseTeamMasterWorkbook(buildWorkbookBuffer())
  const existing = [
    member({ id: 'm-kian', name: 'Kian Ghalibaf', email: 'kian@pangea3.com', salary: 175000, bonus: 0, dept: 'Business Development', ft: 'PT', role: 'Head of BD', entity: 'Zagreus', classification: 'Contractor', location: 'US - Texas' }),
  ]
  const { ops } = buildTeamImportPlan(rows, existing, '09')
  assert.equal(ops.some((op) => op.type === 'add' && op.input.email === 'kian@orca.so'), false)
})

test('plan: active members missing from the file are proposed for deactivation', () => {
  const rows = parseTeamMasterWorkbook(buildWorkbookBuffer())
  const existing = [
    member({ id: 'm-gone', name: 'Left Person', email: 'left@orca.so', status: 'Current' }),
    member({ id: 'm-term', name: 'Already Terminated', email: 'old@orca.so', status: 'Terminated' }),
  ]
  const { ops } = buildTeamImportPlan(rows, existing, '09')
  const deact = ops.find((op) => op.type === 'deactivate' && op.memberId === 'm-gone')
  assert.ok(deact)
  assert.equal(deact?.input.status, 'Terminated')
  assert.equal(deact?.input.terminationMonth, '09')
  // already-terminated members are left alone
  assert.equal(ops.some((op) => op.type === 'deactivate' && op.memberId === 'm-term'), false)
})
