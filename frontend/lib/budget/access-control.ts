import { NextRequest, NextResponse } from 'next/server'

import {
  canAccessBudgetTab,
  canImportBudget,
  canManageBudgetTeam,
  canViewBudgetOverviewAllDepartments,
  canViewBudgetDepartment,
  getAccessForEmail,
  hasBudgetPageAccess,
  type AccessMeResponse,
} from '@/lib/access'
import { getAuthenticatedUser, type AuthenticatedUser } from '@/lib/auth/server'
export {
  filterBudgetPlanStateForAccess,
  filterBudgetStateForAccess,
  filterBudgetTeamMembersForAccess,
  filterBudgetTeamStateForAccess,
} from '@/lib/budget/access-scope'

type BudgetAccessRequirement = 'view' | 'overview' | 'import' | 'manage-team'

type BudgetAccessResult =
  | {
      ok: true
      access: AccessMeResponse
      user: AuthenticatedUser
    }
  | {
      ok: false
      response: NextResponse
    }

function accessNotConfiguredResponse() {
  return NextResponse.json(
    {
      error: 'Access not configured',
      message: 'Your account does not have access permissions. Please contact an administrator.',
    },
    { status: 403 },
  )
}

function requirementErrorMessage(requirement: BudgetAccessRequirement): string {
  switch (requirement) {
    case 'import':
      return 'You do not have permission to manage budget imports.'
    case 'manage-team':
      return 'You do not have permission to manage budget team data.'
    case 'overview':
      return 'Your budget access is limited to department-scoped views.'
    case 'view':
    default:
      return 'Budget access is required.'
  }
}

function getRequestedBudgetYear(req: NextRequest): number | null {
  const rawYear = req.nextUrl.searchParams.get('year')
  const year = Number.parseInt(rawYear ?? '', 10)
  return Number.isFinite(year) ? year : null
}

export async function requireBudgetAccess(
  req: NextRequest,
  options: {
    requirement?: BudgetAccessRequirement
    department?: string | null
  } = {},
): Promise<BudgetAccessResult> {
  const requirement = options.requirement ?? 'view'
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  try {
    const access = await getAccessForEmail(user.email, { year: getRequestedBudgetYear(req) })
    if (!access) {
      return { ok: false, response: accessNotConfiguredResponse() }
    }

    const allowed =
      requirement === 'import'
        ? canImportBudget(access)
        : requirement === 'manage-team'
          ? canManageBudgetTeam(access)
          : requirement === 'overview'
            ? canViewBudgetOverviewAllDepartments(access)
            : hasBudgetPageAccess(access)

    if (!allowed) {
      return {
        ok: false,
        response: NextResponse.json({ error: requirementErrorMessage(requirement) }, { status: 403 }),
      }
    }

    const requestedDepartment = options.department?.trim()
    if (requestedDepartment && !canViewBudgetDepartment(access, requestedDepartment)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `You do not have access to ${requestedDepartment}.` },
          { status: 403 },
        ),
      }
    }

    return { ok: true, access, user }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Access lookup failed'
    return {
      ok: false,
      response: NextResponse.json({ error: 'Access lookup failed', detail: message }, { status: 503 }),
    }
  }
}

export async function requireBudgetTabAccess(
  req: NextRequest,
  tab: string,
): Promise<BudgetAccessResult> {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult

  if (!canAccessBudgetTab(accessResult.access, tab)) {
    return {
      ok: false,
      response: NextResponse.json({ error: `You do not have access to the ${tab} budget tab.` }, { status: 403 }),
    }
  }

  return accessResult
}
