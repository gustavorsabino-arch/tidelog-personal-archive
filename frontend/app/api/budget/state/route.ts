import { NextRequest, NextResponse } from 'next/server'

import { canViewBudgetOverviewAllDepartments, getAllowedBudgetDepartments } from '@/lib/access'
import { filterBudgetStateForAccess, requireBudgetAccess } from '@/lib/budget/access-control'
import { normalizeBudgetYear } from '@/lib/budget/scope'
import { loadBudgetState } from '@/lib/budget/source'
import type { BudgetDepartment } from '@/lib/budget/types'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = normalizeBudgetYear(Number.parseInt(req.nextUrl.searchParams.get('year') ?? '2026', 10))
  const noCache = req.nextUrl.searchParams.get('fresh') === '1'
  const allowedDepartments = getAllowedBudgetDepartments(accessResult.access)
  const canViewAllDepartmentsOverview = canViewBudgetOverviewAllDepartments(accessResult.access)
  const state = await loadBudgetState(year, noCache, {
    planDepartments:
      allowedDepartments === null || canViewAllDepartmentsOverview
        ? null
        : allowedDepartments as BudgetDepartment[],
  })
  return NextResponse.json(filterBudgetStateForAccess(state, accessResult.access))
}
