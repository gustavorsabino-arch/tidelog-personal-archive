import { NextRequest, NextResponse } from 'next/server'

import type { BudgetBootstrapResponse } from '@/lib/budget/bootstrap'
import {
  canViewAllBudgetDepartments,
  filterBudgetStateForAccess,
  getAllowedBudgetDepartmentsForUser,
  requireBudgetAccess,
} from '@/lib/budget/access-control'
import { normalizeBudgetYear } from '@/lib/budget/scope'
import { loadBudgetState } from '@/lib/budget/source'
import { loadQboStatuses } from '@/lib/qb/status'
import type { QboConnectionStatus } from '@/lib/qb/types'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = normalizeBudgetYear(Number.parseInt(req.nextUrl.searchParams.get('year') ?? '2026', 10))
  const noCache = req.nextUrl.searchParams.get('fresh') === '1'
  const isAdmin = canViewAllBudgetDepartments(accessResult.user)
  const allowedDepartments = getAllowedBudgetDepartmentsForUser(accessResult.user)

  // Non-admins cannot see team comp data or QB connection details. Skip both
  // queries entirely so confidential data never lands in their response.
  const [state, qbStatusResult] = await Promise.all([
    // Team is always fetched lazily via /api/budget/team when the Headcount
    // or Team tab is activated; never include it in the bootstrap payload.
    loadBudgetState(year, noCache, { planDepartments: allowedDepartments, includeTeam: false }),
    isAdmin
      ? loadQboStatuses()
          .then((qbStatuses) => ({ qbStatuses: qbStatuses as QboConnectionStatus[] | null, qbStatusError: null as string | null }))
          .catch((error) => {
            console.error('[budget/bootstrap] loadQboStatuses failed', error)
            return {
              qbStatuses: [] as QboConnectionStatus[] | null,
              qbStatusError: 'Failed to load QuickBooks status.',
            }
          })
      : Promise.resolve({ qbStatuses: null as QboConnectionStatus[] | null, qbStatusError: null as string | null }),
  ])

  const response: BudgetBootstrapResponse = {
    state: filterBudgetStateForAccess(state, accessResult.user),
    qbStatuses: qbStatusResult.qbStatuses,
    qbStatusError: qbStatusResult.qbStatusError,
    allowedBudgetMonthIndices: null,
  }

  return NextResponse.json(response)
}
