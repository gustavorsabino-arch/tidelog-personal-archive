// Diff/mapping logic for syncing the Team Tracker roster from the MASTER
// sheet's data (baked into the one-off sync endpoint — no file upload).
//
// Salary comes from the MASTER's "Stables" column; bonus is intentionally
// cleared — the Team Tracker tracks stables-only compensation.

import { BUDGET_DEPTS } from '../constants.ts'
import type {
  BudgetDepartment,
  BudgetMonthKey,
  BudgetTeamMember,
  BudgetTeamMemberInput,
} from './types.ts'

export type TeamMasterRow = {
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

// Strip "(Company LLC)" style suffixes so MASTER names match app names.
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
    email: row.email.trim().toLowerCase(),
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
): { ops: TeamImportOp[]; matchedIds: Set<string> } {
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
    const email = row.email.trim().toLowerCase()
    const match = (email ? byEmail.get(email) : undefined) ?? byName.get(nameKey(row.name))
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

  return { ops, matchedIds }
}
