// Pure parsing + diff logic for the "Team Tracker - MASTER" workbook import.
//
// The MASTER sheet ("Total Comp Tracker") stacks several numbered sections:
// the current team (1..N), then advisors, then terminated people — each
// restarting its numbering at 1. Only the FIRST block is the roster of
// interest, so parsing stops as soon as the numbering stops increasing.
//
// Salary comes from the "Stables" column; bonus is intentionally cleared —
// the Team Tracker tracks stables-only compensation.

import * as XLSX from 'xlsx'

import { BUDGET_DEPTS } from '../constants.ts'
import type {
  BudgetDepartment,
  BudgetMonthKey,
  BudgetTeamMember,
  BudgetTeamMemberInput,
} from './types.ts'

export type TeamMasterRow = {
  num: number
  status: string
  name: string
  email: string
  entity: string
  classification: string
  dept: string
  ft: string
  role: string
  location: string
  stables: number
}

const HEADER_COLUMNS: Array<{ field: keyof TeamMasterRow; labels: string[] }> = [
  { field: 'num', labels: ['current'] },
  { field: 'status', labels: ['status'] },
  { field: 'name', labels: ['name'] },
  { field: 'email', labels: ['orca email'] },
  { field: 'entity', labels: ['entity'] },
  { field: 'classification', labels: ['classification'] },
  { field: 'dept', labels: ['department/class', 'department'] },
  { field: 'ft', labels: ['pt/ft', 'ft/pt'] },
  { field: 'role', labels: ['role'] },
  { field: 'location', labels: ['location'] },
  { field: 'stables', labels: ['stables'] },
]

function cellText(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function cellNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number.parseFloat(cellText(value).replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function findHeaderRow(rows: unknown[][]): { index: number; cols: Partial<Record<keyof TeamMasterRow, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const labels = (rows[i] ?? []).map((c) => cellText(c).toLowerCase())
    if (labels.includes('current') && labels.includes('status') && labels.includes('name')) {
      const cols: Partial<Record<keyof TeamMasterRow, number>> = {}
      for (const { field, labels: wanted } of HEADER_COLUMNS) {
        const idx = labels.findIndex((l) => wanted.includes(l))
        if (idx >= 0) cols[field] = idx
      }
      return { index: i, cols }
    }
  }
  return null
}

// Rows of the FIRST numbered block only (1, 2, 3… until the numbering resets
// for the next section or stops).
export function parseTeamMasterRows(rows: unknown[][]): TeamMasterRow[] {
  const header = findHeaderRow(rows)
  if (!header) return []
  const at = (row: unknown[], field: keyof TeamMasterRow) => {
    const idx = header.cols[field]
    return idx === undefined ? undefined : row[idx]
  }

  const out: TeamMasterRow[] = []
  let expected = 1
  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const num = at(row, 'num')
    const isNumber = typeof num === 'number' && Number.isFinite(num)
    if (!isNumber) {
      if (out.length > 0) break // block ended (section label / blank row)
      continue // still looking for the block's first row
    }
    if (num !== expected) {
      if (out.length > 0) break // numbering reset → next section
      if (num !== 1) continue
    }
    out.push({
      num: num as number,
      status: cellText(at(row, 'status')),
      name: cellText(at(row, 'name')),
      email: cellText(at(row, 'email')).toLowerCase(),
      entity: cellText(at(row, 'entity')),
      classification: cellText(at(row, 'classification')),
      dept: cellText(at(row, 'dept')),
      ft: cellText(at(row, 'ft')),
      role: cellText(at(row, 'role')),
      location: cellText(at(row, 'location')),
      stables: cellNumber(at(row, 'stables')),
    })
    expected = (num as number) + 1
  }
  return out
}

export function parseTeamMasterWorkbook(buffer: ArrayBuffer): TeamMasterRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName =
    workbook.SheetNames.find((n) => n.toLowerCase().includes('total comp')) ?? workbook.SheetNames[0]
  if (!sheetName) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1 })
  return parseTeamMasterRows(rows)
}

// MASTER sheet department names → canonical BUDGET_DEPTS.
const DEPT_MAP: Record<string, BudgetDepartment> = {
  eng: 'Engineering',
  engineering: 'Engineering',
  bd: 'Business Development',
  'business development': 'Business Development',
  growth: 'Marketing',
  marketing: 'Marketing',
  ops: 'Ops',
  legal: 'Legal',
  finance: 'Finance',
  product: 'Product',
  general: 'General',
}

function mapDepartment(raw: string): BudgetDepartment {
  const mapped = DEPT_MAP[raw.trim().toLowerCase()]
  if (mapped) return mapped
  return (BUDGET_DEPTS as readonly string[]).includes(raw.trim())
    ? (raw.trim() as BudgetDepartment)
    : 'General'
}

function normalizeFt(raw: string): string {
  return raw.trim().toLowerCase().startsWith('p') ? 'PT' : 'FT'
}

function isCurrentStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'current'
}

// Strip "(Company LLC)" style suffixes so file names match app names.
function nameKey(name: string): string {
  return name.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
}

export function mapMasterRowToInput(
  row: TeamMasterRow,
  terminationMonth: BudgetMonthKey,
  keepName?: string,
): BudgetTeamMemberInput {
  const current = isCurrentStatus(row.status)
  return {
    name: keepName ?? row.name,
    email: row.email,
    dept: mapDepartment(row.dept),
    role: row.role,
    salary: row.stables,
    bonus: 0, // stables-only comp: bonus intentionally cleared
    status: current ? 'Current' : 'Terminated',
    entity: row.entity,
    classification: row.classification,
    location: row.location,
    ft: normalizeFt(row.ft),
    terminationMonth: current ? null : terminationMonth,
  }
}

export type TeamImportOp =
  | { type: 'add'; input: BudgetTeamMemberInput }
  | { type: 'update'; memberId: string; memberName: string; input: BudgetTeamMemberInput; changes: string[] }
  | {
      type: 'deactivate'
      memberId: string
      memberName: string
      input: BudgetTeamMemberInput
      reason: 'missing-from-file'
    }

const DIFF_FIELDS = [
  'email', 'dept', 'role', 'salary', 'bonus', 'entity', 'classification', 'location', 'ft', 'status',
] as const

function memberToInput(member: BudgetTeamMember): BudgetTeamMemberInput {
  return {
    name: member.name,
    email: member.email.toLowerCase(),
    dept: member.dept,
    role: member.role,
    salary: member.salary,
    bonus: member.bonus,
    status: member.status,
    entity: member.entity,
    classification: member.classification,
    location: member.location,
    ft: normalizeFt(member.ft),
    terminationMonth: member.terminationMonth,
  }
}

function changedFields(existing: BudgetTeamMemberInput, next: BudgetTeamMemberInput): string[] {
  return DIFF_FIELDS.filter((field) => existing[field] !== next[field])
}

export function buildTeamImportPlan(
  fileRows: TeamMasterRow[],
  existing: BudgetTeamMember[],
  terminationMonth: BudgetMonthKey,
): { ops: TeamImportOp[] } {
  const byEmail = new Map<string, BudgetTeamMember>()
  const byName = new Map<string, BudgetTeamMember>()
  for (const member of existing) {
    const email = member.email.trim().toLowerCase()
    if (email && !byEmail.has(email)) byEmail.set(email, member)
    const key = nameKey(member.name)
    if (key && !byName.has(key)) byName.set(key, member)
  }

  const matchedIds = new Set<string>()
  const ops: TeamImportOp[] = []

  for (const row of fileRows) {
    const match = (row.email ? byEmail.get(row.email) : undefined) ?? byName.get(nameKey(row.name))
    if (match) {
      matchedIds.add(match.id)
      const input = mapMasterRowToInput(row, terminationMonth, match.name)
      const changes = changedFields(memberToInput(match), input)
      if (changes.length > 0) {
        ops.push({ type: 'update', memberId: match.id, memberName: match.name, input, changes })
      }
    } else {
      ops.push({ type: 'add', input: mapMasterRowToInput(row, terminationMonth) })
    }
  }

  for (const member of existing) {
    if (member.status !== 'Current' || matchedIds.has(member.id)) continue
    ops.push({
      type: 'deactivate',
      memberId: member.id,
      memberName: member.name,
      input: { ...memberToInput(member), status: 'Terminated', terminationMonth },
      reason: 'missing-from-file',
    })
  }

  return { ops }
}
