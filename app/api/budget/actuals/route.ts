import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import { parseBudgetViewFromSearchParams } from '@/lib/budget/api-view'
import { fetchBudgetOverviewActuals } from '@/lib/budget/qb-actuals'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'overview' })
  if (!accessResult.ok) return accessResult.response

  try {
    const view = parseBudgetViewFromSearchParams(req.nextUrl.searchParams)
    const actuals = await fetchBudgetOverviewActuals(view)
    return NextResponse.json(actuals)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch QuickBooks actuals.'
    const status =
      message.includes('not connected') ? 409
      : message.includes('not configured') ? 503
      : 500
    return NextResponse.json({ error: message }, { status })
  }
}
