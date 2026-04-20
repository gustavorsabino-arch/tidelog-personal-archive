import { NextRequest, NextResponse } from 'next/server'

import { filterBudgetTeamStateForAccess, requireBudgetAccess } from '@/lib/budget/access-control'
import { loadBudgetTeamState } from '@/lib/budget/source'
import {
  getBudgetTeamFilePath,
  restoreBudgetTeamMember,
  terminateBudgetTeamMember,
  upsertBudgetTeamMember,
  validateBudgetTeamMemberInput,
} from '@/lib/budget/team'
import type { BudgetTeamMutationResult, BudgetTeamState } from '@/lib/budget/types'
import { writeDataFile } from '@/lib/github'

export const runtime = 'nodejs'

async function requireBudgetTeamAccess(req: NextRequest) {
  return requireBudgetAccess(req, { requirement: 'manage-team' })
}

function parseYear(req: NextRequest, bodyYear?: unknown): number | null {
  const raw = bodyYear ?? req.nextUrl.searchParams.get('year') ?? '2026'
  const year = Number.parseInt(String(raw), 10)
  return Number.isFinite(year) ? year : null
}

async function persistTeamState(state: BudgetTeamState, year: number, message: string) {
  return writeDataFile(getBudgetTeamFilePath(year), state, message)
}

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = parseYear(req)
  if (year === null) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  const team = await loadBudgetTeamState(year, req.nextUrl.searchParams.get('fresh') === '1')
  return NextResponse.json(filterBudgetTeamStateForAccess(team, accessResult.access))
}

export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetTeamAccess(req)
  if (!accessResult.ok) return accessResult.response

  const body = await req.json().catch(() => null)
  const action = typeof body?.action === 'string' ? body.action : ''
  const year = parseYear(req, body?.year)

  if (year === null) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  const currentTeam = await loadBudgetTeamState(year, true)
  const meta = {
    updatedAt: new Date().toISOString(),
    updatedBy: accessResult.user.email,
  }

  try {
    if (action === 'create-member') {
      const member = validateBudgetTeamMemberInput(body?.member)
      const result = upsertBudgetTeamMember(currentTeam, member, meta)
      const ok = await persistTeamState(
        result.state,
        year,
        `budget: add team member ${result.memberId} ${year}`,
      )
      if (!ok) {
        return NextResponse.json({ error: 'Failed to persist the new team member.' }, { status: 500 })
      }

      const response: BudgetTeamMutationResult = {
        success: true,
        year,
        action,
        memberId: result.memberId,
        team: result.state,
      }
      return NextResponse.json(response)
    }

    if (action === 'update-member') {
      const memberId = Number.parseInt(String(body?.memberId ?? ''), 10)
      if (!Number.isFinite(memberId)) {
        return NextResponse.json({ error: 'Valid memberId required.' }, { status: 400 })
      }

      const member = validateBudgetTeamMemberInput(body?.member)
      const result = upsertBudgetTeamMember(currentTeam, member, meta, memberId)
      const ok = await persistTeamState(
        result.state,
        year,
        `budget: update team member ${memberId} ${year}`,
      )
      if (!ok) {
        return NextResponse.json({ error: 'Failed to persist the updated team member.' }, { status: 500 })
      }

      const response: BudgetTeamMutationResult = {
        success: true,
        year,
        action,
        memberId,
        team: result.state,
      }
      return NextResponse.json(response)
    }

    if (action === 'terminate-member' || action === 'delete-member') {
      const memberId = Number.parseInt(String(body?.memberId ?? ''), 10)
      if (!Number.isFinite(memberId)) {
        return NextResponse.json({ error: 'Valid memberId required.' }, { status: 400 })
      }

      const terminationMonth = typeof body?.terminationMonth === 'string' ? body.terminationMonth : body?.member?.terminationMonth
      const validatedMember = validateBudgetTeamMemberInput({
        ...(currentTeam.members.find((member) => member.id === memberId) ?? {}),
        status: 'Terminated',
        terminationMonth,
      })
      const nextState = terminateBudgetTeamMember(currentTeam, memberId, validatedMember.terminationMonth!, meta)
      const ok = await persistTeamState(
        nextState,
        year,
        `budget: terminate team member ${memberId} ${year}`,
      )
      if (!ok) {
        return NextResponse.json({ error: 'Failed to persist the team member termination.' }, { status: 500 })
      }

      const response: BudgetTeamMutationResult = {
        success: true,
        year,
        action: 'terminate-member',
        memberId,
        team: nextState,
      }
      return NextResponse.json(response)
    }

    if (action === 'restore-member') {
      const memberId = Number.parseInt(String(body?.memberId ?? ''), 10)
      if (!Number.isFinite(memberId)) {
        return NextResponse.json({ error: 'Valid memberId required.' }, { status: 400 })
      }

      const nextState = restoreBudgetTeamMember(currentTeam, memberId, meta)
      const ok = await persistTeamState(
        nextState,
        year,
        `budget: restore team member ${memberId} ${year}`,
      )
      if (!ok) {
        return NextResponse.json({ error: 'Failed to persist the team member restore.' }, { status: 500 })
      }

      const response: BudgetTeamMutationResult = {
        success: true,
        year,
        action: 'restore-member',
        memberId,
        team: nextState,
      }
      return NextResponse.json(response)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown team mutation error'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return NextResponse.json({ error: 'Invalid team action' }, { status: 400 })
}
