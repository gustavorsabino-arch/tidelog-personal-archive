import { NextRequest, NextResponse } from 'next/server'

import { getAllowedBudgetDepartments, getAllowedBudgetMonthIndices } from '@/lib/access'
import type { BudgetBootstrapResponse } from '@/lib/budget/bootstrap'
import { filterBudgetStateForAccess, requireBudgetAccess } from '@/lib/budget/access-control'
import { normalizeBudgetYear } from '@/lib/budget/scope'
import { loadBudgetState } from '@/lib/budget/source'
import type { BudgetDepartment } from '@/lib/budget/types'
import { loadQboStatuses } from '@/lib/qb/status'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = normalizeBudgetYear(Number.parseInt(req.nextUrl.searchParams.get('year') ?? '2026', 10))
  const noCache = req.nextUrl.searchParams.get('fresh') === '1'
  const allowedDepartments = getAllowedBudgetDepartments(accessResult.access)

  const [state, qbStatusResult] = await Promise.all([
    loadBudgetState(year, noCache, {
      planDepartments: allowedDepartments === null ? null : allowedDepartments as BudgetDepartment[],
    }),
    loadQboStatuses()
      .then((qbStatuses) => ({ qbStatuses, qbStatusError: null }))
      .catch((error) => ({
        qbStatuses: [],
        qbStatusError: error instanceof Error ? error.message : 'Failed to load QuickBooks status.',
      })),
  ])

  const response: BudgetBootstrapResponse = {
    state: filterBudgetStateForAccess(state, accessResult.access),
    qbStatuses: qbStatusResult.qbStatuses,
    qbStatusError: qbStatusResult.qbStatusError,
    allowedBudgetMonthIndices: getAllowedBudgetMonthIndices(accessResult.access),
  }

  return NextResponse.json(response)
}
