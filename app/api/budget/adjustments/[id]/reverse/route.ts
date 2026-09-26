import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { requireBudgetAccess } from '@/lib/budget/access-control'
import { budgetAdjustmentErrorResponse } from '@/lib/budget/adjustment-errors'
import { reverseBudgetAdjustment } from '@/lib/budget/adjustments-db'

export const runtime = 'nodejs'

// POST /api/budget/adjustments/[id]/reverse — mark an adjustment reversed
// (admin only). Append-only: the row stays for the log; only its status flips.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'import' })
  if (!accessResult.ok) return accessResult.response

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Adjustment id required' }, { status: 400 })
  }

  try {
    await reverseBudgetAdjustment(id, accessResult.user.email)
  } catch (error) {
    return budgetAdjustmentErrorResponse(error, 'reverse')
  }

  await logAudit({
    userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
    action: 'budget.adjustment.reversed',
    metadata: { id },
  })

  return NextResponse.json({ ok: true })
}
