import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import {
  filterBudgetTeamStateForAdminScope,
  requireBudgetAccess,
  requireBudgetTabAccess,
} from '@/lib/budget/access-control'
import { loadBudgetTeamState } from '@/lib/budget/source'
import {
  createBudgetTeamMemberInDb,
  setBudgetTeamMemberStatusInDb,
  updateBudgetTeamMemberInDb,
  validateBudgetTeamMemberInput,
} from '@/lib/budget/team'
import type { BudgetTeamMutationResult } from '@/lib/budget/types'

export const runtime = 'nodejs'

async function requireBudgetTeamAccess(req: NextRequest) {
  return requireBudgetAccess(req, { requirement: 'manage-team' })
}

function parseYear(req: NextRequest, bodyYear?: unknown): number | null {
  const raw = bodyYear ?? req.nextUrl.searchParams.get('year') ?? '2026'
  const year = Number.parseInt(String(raw), 10)
  return Number.isFinite(year) ? year : null
}

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'team')
  if (!accessResult.ok) return accessResult.response

  const year = parseYear(req)
  if (year === null) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  const team = await loadBudgetTeamState(year, req.nextUrl.searchParams.get('fresh') === '1')
  return NextResponse.json(filterBudgetTeamStateForAdminScope(team, accessResult.user))
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

  const user = accessResult.user

  try {
    if (action === 'create-member') {
      const member = validateBudgetTeamMemberInput(body?.member)
      const memberId = await createBudgetTeamMemberInDb(member)
      const team = await loadBudgetTeamState(year, true)
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'budget.team_member.created',
        resourceType: 'budget_team_member',
        resourceId: memberId,
        metadata: { year, email: member.email, dept: member.dept },
      })
      const response: BudgetTeamMutationResult = {
        success: true,
        year,
        action,
        memberId,
        team,
      }
      return NextResponse.json(response)
    }

    if (action === 'update-member') {
      const memberId = typeof body?.memberId === 'string' ? body.memberId : null
      if (!memberId) {
        return NextResponse.json({ error: 'Valid memberId required.' }, { status: 400 })
      }

      const member = validateBudgetTeamMemberInput(body?.member)
      await updateBudgetTeamMemberInDb(memberId, member)
      const team = await loadBudgetTeamState(year, true)
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'budget.team_member.updated',
        resourceType: 'budget_team_member',
        resourceId: memberId,
        metadata: { year, email: member.email, dept: member.dept },
      })
      const response: BudgetTeamMutationResult = {
        success: true,
        year,
        action,
        memberId,
        team,
      }
      return NextResponse.json(response)
    }

    if (action === 'terminate-member' || action === 'delete-member') {
      const memberId = typeof body?.memberId === 'string' ? body.memberId : null
      if (!memberId) {
        return NextResponse.json({ error: 'Valid memberId required.' }, { status: 400 })
      }

      await setBudgetTeamMemberStatusInDb(memberId, 'inactive')
      const team = await loadBudgetTeamState(year, true)
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'budget.team_member.terminated',
        resourceType: 'budget_team_member',
        resourceId: memberId,
        metadata: { year },
      })
      const response: BudgetTeamMutationResult = {
        success: true,
        year,
        action: 'terminate-member',
        memberId,
        team,
      }
      return NextResponse.json(response)
    }

    if (action === 'restore-member') {
      const memberId = typeof body?.memberId === 'string' ? body.memberId : null
      if (!memberId) {
        return NextResponse.json({ error: 'Valid memberId required.' }, { status: 400 })
      }

      await setBudgetTeamMemberStatusInDb(memberId, 'active')
      const team = await loadBudgetTeamState(year, true)
      await logAudit({
        userId: user.id === 'dev-user' ? null : user.id,
        action: 'budget.team_member.restored',
        resourceType: 'budget_team_member',
        resourceId: memberId,
        metadata: { year },
      })
      const response: BudgetTeamMutationResult = {
        success: true,
        year,
        action: 'restore-member',
        memberId,
        team,
      }
      return NextResponse.json(response)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown team mutation error'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return NextResponse.json({ error: 'Invalid team action' }, { status: 400 })
}
