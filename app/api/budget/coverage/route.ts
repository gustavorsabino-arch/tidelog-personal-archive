import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetTabAccess } from '@/lib/budget/access-control'
import { parseBudgetViewFromSearchParams } from '@/lib/budget/api-view'
import { fetchBudgetCoverage } from '@/lib/budget/qb-coverage'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'coverage')
  if (!accessResult.ok) return accessResult.response

  try {
    const view = parseBudgetViewFromSearchParams(req.nextUrl.searchParams)
    const coverage = await fetchBudgetCoverage(view)
    return NextResponse.json(coverage)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('not connected')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message.includes('not configured')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }
    console.error('[budget/coverage]', error)
    return NextResponse.json({ error: 'Failed to fetch QuickBooks coverage.' }, { status: 500 })
  }
}
