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
    const message = error instanceof Error ? error.message : ''
    if (message.includes('not connected')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message.includes('not configured')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }
    console.error('[budget/actuals]', error)
    return NextResponse.json({ error: 'Failed to fetch QuickBooks actuals.' }, { status: 500 })
  }
}
