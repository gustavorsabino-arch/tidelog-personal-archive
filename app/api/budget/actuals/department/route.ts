import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import { parseBudgetViewFromSearchParams } from '@/lib/budget/api-view'
import { fetchBudgetDepartmentActuals } from '@/lib/budget/qb-department-actuals'
import { isBudgetDepartmentActualScope } from '@/lib/budget/qb-class'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const department = req.nextUrl.searchParams.get('department') ?? ''
  if (!isBudgetDepartmentActualScope(department)) {
    return NextResponse.json({ error: 'A valid budget department is required.' }, { status: 400 })
  }

  const accessResult = department !== 'Not specified'
    ? await requireBudgetAccess(req, { department })
    : await requireBudgetAccess(req, { requirement: 'overview' })
  if (!accessResult.ok) return accessResult.response

  try {
    const view = parseBudgetViewFromSearchParams(req.nextUrl.searchParams)
    const actuals = await fetchBudgetDepartmentActuals(view, department)
    return NextResponse.json(actuals)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('not connected')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message.includes('not configured')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }
    console.error('[budget/actuals/department]', error)
    return NextResponse.json({ error: 'Failed to fetch department QuickBooks actuals.' }, { status: 500 })
  }
}
