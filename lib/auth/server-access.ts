import { BUDGET_DEPTS } from '@/lib/constants'
import type { AccessMeResponse } from '@/lib/access-model'
import type { BudgetDepartment } from '@/lib/budget/types'
import { getServerUser } from './get-user'

/**
 * Build the AccessMeResponse from x-user-* request headers (or next/headers
 * fallback). Used by GET /api/me and by the root server layout to inline
 * access into the HTML, eliminating the /api/me round-trip on first paint.
 *
 * Returns null when no authenticated user is on the request.
 */
export async function getInitialAccess(req?: Request): Promise<AccessMeResponse | null> {
  const user = await getServerUser(req)
  if (!user) return null

  const isAdmin = user.role === 'admin'
  const budgetDepartments: BudgetDepartment[] | null = isAdmin
    ? null
    : user.departments.filter((d): d is BudgetDepartment =>
        (BUDGET_DEPTS as readonly string[]).includes(d),
      )

  return {
    email: user.email,
    role: user.role,
    departments: user.departments,
    permissions: {
      budgetDepartments,
      canImportBudget: isAdmin,
      canManageBudgetTeam: isAdmin,
    },
  }
}
