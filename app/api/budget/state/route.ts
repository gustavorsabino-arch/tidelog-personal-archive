import { NextRequest, NextResponse } from 'next/server'

import {
  canViewAllBudgetDepartments,
  filterBudgetStateForAccess,
  getAllowedBudgetDepartmentsForUser,
  requireBudgetAccess,
} from '@/lib/budget/access-control'
import { normalizeBudgetYear } from '@/lib/budget/scope'
import { loadBudgetState } from '@/lib/budget/source'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = normalizeBudgetYear(Number.parseInt(req.nextUrl.searchParams.get('year') ?? '2026', 10))
  const noCache = req.nextUrl.searchParams.get('fresh') === '1'
  const allowedDepartments = getAllowedBudgetDepartmentsForUser(accessResult.user)
  const state = await loadBudgetState(year, noCache, {
    planDepartments: canViewAllBudgetDepartments(accessResult.user) ? null : allowedDepartments,
  })
  return NextResponse.json(filterBudgetStateForAccess(state, accessResult.user))
}
