import { NextRequest, NextResponse } from 'next/server'

import { getServerUser, type ServerUser } from '@/lib/auth/get-user'
import { hasPermission, type Permission } from '@/lib/auth/permissions'
import { logAudit } from '@/lib/audit'
import { canViewAllBudgetDepartments, canViewBudgetDepartment } from './access-scope'

export {
  canViewAllBudgetDepartments,
  canViewBudgetDepartment,
  filterBudgetPlanStateForAccess,
  filterBudgetStateForAccess,
  filterBudgetTeamMembersForAdminScope,
  filterBudgetTeamStateForAdminScope,
  getAllowedBudgetDepartmentsForUser,
} from './access-scope'

export type BudgetAccessRequirement = 'view' | 'overview' | 'import' | 'manage-team'

export type BudgetAccessResult =
  | { ok: true; user: ServerUser }
  | { ok: false; response: NextResponse }

function denyForPermission(user: ServerUser | null, required: Permission) {
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized', code: 'auth.unauthorized' }, { status: 401 })
  }
  // Fire-and-forget — audit writes must not block the 403 response. The
  // explicit `.catch` prevents any low-level DB error (e.g. socket timeout
  // after the response has been sent) from becoming an unhandled rejection.
  logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: 'access.denied.forbidden',
    metadata: { required, role: user.role, email: user.email },
  }).catch(() => {})
  return NextResponse.json(
    { error: 'Forbidden', code: 'auth.forbidden', details: { required } },
    { status: 403 },
  )
}

function deny(message: string, status = 403) {
  return NextResponse.json({ error: message }, { status })
}

export async function requireBudgetAccess(
  req: NextRequest,
  options: {
    requirement?: BudgetAccessRequirement
    department?: string | null
  } = {},
): Promise<BudgetAccessResult> {
  const requirement = options.requirement ?? 'view'
  const user = await getServerUser(req)

  const required: Permission =
    requirement === 'import' || requirement === 'manage-team' ? 'budget:write' : 'budget:read'

  if (!user || !hasPermission(user.role, required)) {
    return { ok: false, response: denyForPermission(user, required) }
  }

  if (requirement === 'overview' && !canViewAllBudgetDepartments(user)) {
    return { ok: false, response: deny('Your budget access is limited to department-scoped views.') }
  }

  const requestedDepartment = options.department?.trim()
  if (requestedDepartment && !canViewBudgetDepartment(user, requestedDepartment)) {
    return { ok: false, response: deny(`You do not have access to ${requestedDepartment}.`) }
  }

  return { ok: true, user }
}

const ADMIN_TABS = new Set(['mapping', 'coverage', 'headcount', 'team'])

export async function requireBudgetTabAccess(
  req: NextRequest,
  tab: string,
): Promise<BudgetAccessResult> {
  if (ADMIN_TABS.has(tab)) {
    return requireBudgetAccess(req, { requirement: 'overview' })
  }
  return requireBudgetAccess(req)
}
