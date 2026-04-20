import { NextRequest, NextResponse } from 'next/server'

import { getBudgetViewRestrictions } from '@/lib/access'
import { requireBudgetTabAccess } from '@/lib/budget/access-control'
import { parseBudgetViewFromSearchParams } from '@/lib/budget/api-view'
import { fetchBudgetCoverage } from '@/lib/budget/qb-coverage'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'coverage')
  if (!accessResult.ok) return accessResult.response

  try {
    const view = parseBudgetViewFromSearchParams(
      req.nextUrl.searchParams,
      getBudgetViewRestrictions(accessResult.access),
    )
    const coverage = await fetchBudgetCoverage(view)
    return NextResponse.json(coverage)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch QuickBooks coverage.'
    const status =
      message.includes('not connected') ? 409
        : message.includes('not configured') ? 503
          : 500
    return NextResponse.json({ error: message }, { status })
  }
}
