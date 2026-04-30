import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import { fetchCoreProductRevenueByMonth } from '@/lib/budget/qb-actuals'
import { normalizeBudgetYear } from '@/lib/budget/scope'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = normalizeBudgetYear(Number.parseInt(req.nextUrl.searchParams.get('year') ?? '2026', 10))

  try {
    const breakdown = await fetchCoreProductRevenueByMonth(year)
    return NextResponse.json(breakdown)
  } catch (error) {
    console.error('[budget/revenue/monthly]', error)
    return NextResponse.json({ error: 'Failed to load monthly revenue.' }, { status: 500 })
  }
}
