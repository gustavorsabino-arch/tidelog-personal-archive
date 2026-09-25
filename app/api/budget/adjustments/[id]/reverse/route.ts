import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { requireBudgetAccess } from '@/lib/budget/access-control'
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

  await reverseBudgetAdjustment(id, accessResult.user.email)

  await logAudit({
    userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
    action: 'budget.adjustment.reversed',
    metadata: { id },
  })

  return NextResponse.json({ ok: true })
}
