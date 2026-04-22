import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/get-user'
import { BUDGET_DEPTS } from '@/lib/constants'
import type { AccessMeResponse } from '@/lib/access-model'
import type { BudgetDepartment } from '@/lib/budget/types'

/**
 * Returns the authenticated user's access profile in the shape the UI expects.
 * The proxy has already verified the CF JWT (or applied the dev bypass)
 * and injected x-user-* headers, so reading from them is sufficient.
 *
 * 401 when no user is on the request.
 */
export async function GET(req: Request) {
  const user = await getServerUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isAdmin = user.role === 'admin'
  const budgetDepartments: BudgetDepartment[] | null = isAdmin
    ? null
    : user.departments.filter((d): d is BudgetDepartment => (BUDGET_DEPTS as readonly string[]).includes(d))

  const response: AccessMeResponse = {
    email: user.email,
    role: user.role,
    departments: user.departments,
    permissions: {
      budgetDepartments,
      canImportBudget: isAdmin,
      canManageBudgetTeam: isAdmin,
    },
  }
  return NextResponse.json(response)
}
