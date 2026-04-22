import { eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { budgetTeamMember } from '@/lib/db/schema/budget'
import { BUDGET_DEPTS, ENTITIES } from '../constants.ts'
import type {
  BudgetDepartment,
  BudgetMonthKey,
  BudgetTeamMember,
  BudgetTeamMemberInput,
  BudgetTeamState,
} from './types.ts'

const PLACEHOLDER_BUDGET_YEAR = 2026
const TEAM_STATUSES = new Set(['Current', 'Terminated'])
const BUDGET_MONTH_KEYS: BudgetMonthKey[] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']

type TeamMutationMeta = {
  updatedAt: string
  updatedBy: string
}

type BudgetTeamMemberRow = typeof budgetTeamMember.$inferSelect

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '')
    const parsed = Number.parseFloat(cleaned)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function isBudgetDepartment(value: string): value is BudgetDepartment {
  return (BUDGET_DEPTS as readonly string[]).includes(value)
}

function normalizeDepartment(value: unknown): BudgetDepartment {
  const normalized = normalizeString(value)
  if (!isBudgetDepartment(normalized)) {
    throw new Error(`Invalid department: ${normalized || 'empty value'}`)
  }
  return normalized
}

function normalizeStatus(value: unknown): BudgetTeamMember['status'] {
  const normalized = normalizeString(value)
  return TEAM_STATUSES.has(normalized) ? (normalized as BudgetTeamMember['status']) : 'Current'
}

function normalizeTerminationMonth(value: unknown): BudgetMonthKey | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = String(Math.trunc(value)).padStart(2, '0')
    return BUDGET_MONTH_KEYS.includes(normalized as BudgetMonthKey) ? (normalized as BudgetMonthKey) : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const normalized = trimmed.padStart(2, '0')
    return BUDGET_MONTH_KEYS.includes(normalized as BudgetMonthKey) ? (normalized as BudgetMonthKey) : null
  }

  return null
}

function normalizeEntity(value: unknown): string {
  const normalized = normalizeString(value)
  return normalized || ENTITIES[0]
}

function normalizeTeamMember(member: Partial<BudgetTeamMember>, fallbackId: string): BudgetTeamMember {
  const status = normalizeStatus(member.status)
  const terminationMonth = status === 'Terminated'
    ? normalizeTerminationMonth(member.terminationMonth)
    : null

  return {
    id: typeof member.id === 'string' && member.id.length > 0 ? member.id : fallbackId,
    name: normalizeString(member.name),
    email: normalizeString(member.email).toLowerCase(),
    dept: normalizeDepartment(member.dept),
    role: normalizeString(member.role),
    salary: normalizeNumber(member.salary),
    bonus: normalizeNumber(member.bonus),
    status: normalizeStatus(member.status),
    entity: normalizeEntity(member.entity),
    classification: normalizeString(member.classification),
    location: normalizeString(member.location),
    ft: normalizeString(member.ft),
    terminationMonth,
  }
}

function rowToMember(row: BudgetTeamMemberRow): BudgetTeamMember {
  const status: BudgetTeamMember['status'] = row.status === 'inactive' ? 'Terminated' : 'Current'
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? '',
    dept: isBudgetDepartment(row.department) ? row.department : BUDGET_DEPTS[0],
    role: row.role ?? '',
    salary: row.salary ? Number(row.salary) : 0,
    bonus: row.bonus ? Number(row.bonus) : 0,
    status,
    entity: row.entityId ?? ENTITIES[0],
    classification: row.classification ?? '',
    location: row.location ?? '',
    ft: row.ft ? 'FT' : 'PT',
    terminationMonth: null,
  }
}

function memberToRowValues(
  input: BudgetTeamMemberInput,
): Omit<BudgetTeamMemberRow, 'id' | 'createdAt' | 'updatedAt'> {
  const dbStatus: BudgetTeamMemberRow['status'] = input.status === 'Terminated' ? 'inactive' : 'active'
  return {
    name: input.name,
    email: input.email || null,
    entityId: input.entity || null,
    classification: input.classification || null,
    department: input.dept,
    role: input.role || null,
    location: input.location || null,
    ft: input.ft.toLowerCase().startsWith('f') || input.ft.toLowerCase() === 'true',
    salary: input.salary ? String(input.salary) : null,
    bonus: input.bonus ? String(input.bonus) : null,
    status: dbStatus,
  }
}

export function getBudgetTeamFilePath(year: number | string): string {
  return `budget/${year}/team.json`
}

/**
 * Synchronous empty-team scaffold. Returns no members; DB-backed loads use
 * `loadBudgetTeamState` instead.
 */
export function getBudgetTeamPlaceholderState(year = PLACEHOLDER_BUDGET_YEAR): BudgetTeamState {
  return {
    version: 1,
    year,
    members: [],
    source: 'placeholder-static',
    lastUpdatedAt: null,
    lastUpdatedBy: null,
  }
}

export function normalizeBudgetTeamState(
  input: unknown,
  year: number,
): BudgetTeamState {
  const placeholder = getBudgetTeamPlaceholderState(year)
  if (!input || typeof input !== 'object') return placeholder

  const rawMembers = Array.isArray((input as { members?: unknown[] }).members)
    ? (input as { members: unknown[] }).members
    : null

  if (!rawMembers) return placeholder

  const members = rawMembers.map((member, index) =>
    normalizeTeamMember((member ?? {}) as Partial<BudgetTeamMember>, String(index + 1)),
  )

  return {
    version: 1,
    year,
    members,
    source: 'app-managed',
    lastUpdatedAt:
      typeof (input as { lastUpdatedAt?: unknown }).lastUpdatedAt === 'string'
        ? (input as { lastUpdatedAt: string }).lastUpdatedAt
        : null,
    lastUpdatedBy:
      typeof (input as { lastUpdatedBy?: unknown }).lastUpdatedBy === 'string'
        ? (input as { lastUpdatedBy: string }).lastUpdatedBy
        : null,
  }
}

export function getNextBudgetTeamMemberId(_members: BudgetTeamMember[]): string {
  return crypto.randomUUID()
}

export function validateBudgetTeamMemberInput(input: unknown): BudgetTeamMemberInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Team member data is required.')
  }

  const candidate = input as Partial<BudgetTeamMember>
  const name = normalizeString(candidate.name)
  const role = normalizeString(candidate.role)
  const email = normalizeString(candidate.email).toLowerCase()
  const status = normalizeStatus(candidate.status)
  const terminationMonth = status === 'Terminated'
    ? normalizeTerminationMonth(candidate.terminationMonth)
    : null

  if (!name) throw new Error('Name is required.')
  if (!role) throw new Error('Role is required.')
  if (!email) throw new Error('Email is required.')
  if (status === 'Terminated' && !terminationMonth) {
    throw new Error('Termination month is required for terminated team members.')
  }

  return {
    name,
    email,
    dept: normalizeDepartment(candidate.dept),
    role,
    salary: normalizeNumber(candidate.salary),
    bonus: normalizeNumber(candidate.bonus),
    status,
    entity: normalizeEntity(candidate.entity),
    classification: normalizeString(candidate.classification),
    location: normalizeString(candidate.location),
    ft: normalizeString(candidate.ft),
    terminationMonth,
  }
}

function applyMutationMeta(state: BudgetTeamState, meta: TeamMutationMeta): BudgetTeamState {
  return {
    ...state,
    source: 'app-managed',
    lastUpdatedAt: meta.updatedAt,
    lastUpdatedBy: meta.updatedBy,
  }
}

export function upsertBudgetTeamMember(
  state: BudgetTeamState,
  input: BudgetTeamMemberInput,
  meta: TeamMutationMeta,
  existingId?: string,
): { state: BudgetTeamState; memberId: string } {
  const isUpdate = typeof existingId === 'string' && existingId.length > 0
  const memberId = isUpdate ? existingId : getNextBudgetTeamMemberId(state.members)

  const nextMember: BudgetTeamMember = { id: memberId, ...input }

  const hasExisting = state.members.some((member) => member.id === memberId)
  if (isUpdate && !hasExisting) {
    throw new Error('Team member not found.')
  }

  const nextMembers = hasExisting
    ? state.members.map((member) => (member.id === memberId ? nextMember : member))
    : [...state.members, nextMember]

  return {
    state: applyMutationMeta(
      {
        ...state,
        members: nextMembers.sort((a, b) => a.name.localeCompare(b.name)),
      },
      meta,
    ),
    memberId,
  }
}

export function terminateBudgetTeamMember(
  state: BudgetTeamState,
  memberId: string,
  terminationMonth: BudgetMonthKey,
  meta: TeamMutationMeta,
): BudgetTeamState {
  let found = false
  const nextMembers = state.members.map((member) => {
    if (member.id !== memberId) return member
    found = true
    return { ...member, status: 'Terminated' as const, terminationMonth }
  })

  if (!found) throw new Error('Team member not found.')

  return applyMutationMeta({ ...state, members: nextMembers }, meta)
}

export function restoreBudgetTeamMember(
  state: BudgetTeamState,
  memberId: string,
  meta: TeamMutationMeta,
): BudgetTeamState {
  let found = false
  const nextMembers = state.members.map((member) => {
    if (member.id !== memberId) return member
    found = true
    return { ...member, status: 'Current' as const, terminationMonth: null }
  })

  if (!found) throw new Error('Team member not found.')

  return applyMutationMeta({ ...state, members: nextMembers }, meta)
}

export async function loadBudgetTeamState(year: number, _noCache = false): Promise<BudgetTeamState> {
  const rows = await db.select().from(budgetTeamMember)
  const members = rows.map(rowToMember).sort((a, b) => a.name.localeCompare(b.name))
  const updatedAtIso = rows
    .map((row) => (row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null))
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1) ?? null

  return {
    version: 1,
    year,
    members,
    source: members.length > 0 ? 'app-managed' : 'placeholder-static',
    lastUpdatedAt: updatedAtIso,
    lastUpdatedBy: null,
  }
}

export async function createBudgetTeamMemberInDb(input: BudgetTeamMemberInput): Promise<string> {
  const [row] = await db.insert(budgetTeamMember).values(memberToRowValues(input)).returning({ id: budgetTeamMember.id })
  return row.id
}

export async function updateBudgetTeamMemberInDb(
  memberId: string,
  input: BudgetTeamMemberInput,
): Promise<void> {
  const result = await db
    .update(budgetTeamMember)
    .set({ ...memberToRowValues(input), updatedAt: new Date() })
    .where(eq(budgetTeamMember.id, memberId))
    .returning({ id: budgetTeamMember.id })
  if (result.length === 0) {
    throw new Error('Team member not found.')
  }
}

export async function setBudgetTeamMemberStatusInDb(
  memberId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  const result = await db
    .update(budgetTeamMember)
    .set({ status, updatedAt: new Date() })
    .where(eq(budgetTeamMember.id, memberId))
    .returning({ id: budgetTeamMember.id })
  if (result.length === 0) {
    throw new Error('Team member not found.')
  }
}
