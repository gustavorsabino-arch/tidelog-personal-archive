import { NextRequest, NextResponse } from 'next/server'

import { getAllowedBudgetDepartments } from '@/lib/access'
import { requireBudgetAccess } from '@/lib/budget/access-control'
import { normalizeBudgetYear } from '@/lib/budget/scope'
import { loadBudgetPlanState } from '@/lib/budget/source'
import { getDepartmentAnnualLines } from '@/lib/budget/selectors'
import type { BudgetDepartment } from '@/lib/budget/types'

export const runtime = 'nodejs'

// GET /api/budget/lines — returns budget line items (server-side only)
export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = normalizeBudgetYear(Number.parseInt(req.nextUrl.searchParams.get('year') ?? '2026', 10))
  const noCache = req.nextUrl.searchParams.get('fresh') === '1'
  const allowedDepartments = getAllowedBudgetDepartments(accessResult.access)
  const plan = await loadBudgetPlanState(
    year,
    noCache,
    allowedDepartments === null ? null : allowedDepartments as BudgetDepartment[],
  )
  const visibleDepartments = allowedDepartments === null
    ? Object.keys(plan.departments) as BudgetDepartment[]
    : allowedDepartments as BudgetDepartment[]
  const lines = Object.fromEntries(
    visibleDepartments.map((department) => [department, getDepartmentAnnualLines(plan, department)]),
  )

  return NextResponse.json({ lines, year: plan.year })
}
