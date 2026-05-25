import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetTabAccess } from '@/lib/budget/access-control'
import { parseBudgetViewFromSearchParams } from '@/lib/budget/api-view'
import { fetchBudgetAccountDrill } from '@/lib/budget/qb-account-drill'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'coverage')
  if (!accessResult.ok) return accessResult.response

  const accountNumber = req.nextUrl.searchParams.get('accountNumber')?.trim() ?? ''
  if (!accountNumber) {
    return NextResponse.json({ error: 'accountNumber required' }, { status: 400 })
  }

  try {
    const view = parseBudgetViewFromSearchParams(req.nextUrl.searchParams)
    const drill = await fetchBudgetAccountDrill(view, accountNumber)
    return NextResponse.json(drill)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    console.error('[budget/coverage/drill]', error)
    return NextResponse.json({ error: message || 'Failed to load coverage drill.' }, { status: 500 })
  }
}
