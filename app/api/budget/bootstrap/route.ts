import { NextRequest, NextResponse } from 'next/server'

import type { BudgetBootstrapResponse } from '@/lib/budget/bootstrap'
import {
  filterBudgetStateForAccess,
  getAllowedBudgetDepartmentsForUser,
  requireBudgetAccess,
} from '@/lib/budget/access-control'
import { normalizeBudgetYear } from '@/lib/budget/scope'
import { loadBudgetState } from '@/lib/budget/source'
import { loadQboStatuses } from '@/lib/qb/status'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = normalizeBudgetYear(Number.parseInt(req.nextUrl.searchParams.get('year') ?? '2026', 10))
  const noCache = req.nextUrl.searchParams.get('fresh') === '1'
  const allowedDepartments = getAllowedBudgetDepartmentsForUser(accessResult.user)

  const [state, qbStatusResult] = await Promise.all([
    loadBudgetState(year, noCache, { planDepartments: allowedDepartments }),
    loadQboStatuses()
      .then((qbStatuses) => ({ qbStatuses, qbStatusError: null }))
      .catch((error) => ({
        qbStatuses: [],
        qbStatusError: error instanceof Error ? error.message : 'Failed to load QuickBooks status.',
      })),
  ])

  const response: BudgetBootstrapResponse = {
    state: filterBudgetStateForAccess(state, accessResult.user),
    qbStatuses: qbStatusResult.qbStatuses,
    qbStatusError: qbStatusResult.qbStatusError,
    allowedBudgetMonthIndices: null,
  }

  return NextResponse.json(response)
}
