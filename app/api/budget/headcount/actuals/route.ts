import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetTabAccess } from '@/lib/budget/access-control'
import { parseBudgetViewFromSearchParams } from '@/lib/budget/api-view'
import { fetchBudgetHeadcountActuals } from '@/lib/budget/qb-headcount-actuals'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'headcount')
  if (!accessResult.ok) return accessResult.response

  try {
    const view = parseBudgetViewFromSearchParams(req.nextUrl.searchParams)
    const actuals = await fetchBudgetHeadcountActuals(view)
    return NextResponse.json(actuals)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('not connected')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message.includes('not configured')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }
    console.error('[budget/headcount/actuals]', error)
    return NextResponse.json({ error: 'Failed to fetch headcount actuals.' }, { status: 500 })
  }
}
