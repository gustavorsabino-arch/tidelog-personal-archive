import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { requireBudgetTabAccess } from '@/lib/budget/access-control'
import {
  addBudgetQbMappingExclusion,
  removeBudgetQbMappingExclusion,
} from '@/lib/budget/qb-mapping-exclusion-db'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'coverage')
  if (!accessResult.ok) return accessResult.response

  const body = await req.json().catch(() => null)
  const accountNumber = typeof body?.accountNumber === 'string' ? body.accountNumber.trim() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!accountNumber) return NextResponse.json({ error: 'accountNumber required' }, { status: 400 })
  if (!reason) return NextResponse.json({ error: 'reason required' }, { status: 400 })

  const result = await addBudgetQbMappingExclusion({ accountNumber, reason })
  if (!result.ok) {
    return NextResponse.json(
      {
        error: `Account ${accountNumber} is currently mapped (${result.conflictLine}). Remove the mapping first.`,
        conflictLine: result.conflictLine,
        conflictKey: result.conflictKey,
      },
      { status: 409 },
    )
  }

  await logAudit({
    userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
    action: 'budget.qb_mapping_exclusion.added',
    metadata: { accountNumber, reason },
  })

  return NextResponse.json({ ok: true, row: result.row })
}

export async function DELETE(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'coverage')
  if (!accessResult.ok) return accessResult.response

  const accountNumber = req.nextUrl.searchParams.get('accountNumber')?.trim() ?? ''
  if (!accountNumber) return NextResponse.json({ error: 'accountNumber required' }, { status: 400 })

  await removeBudgetQbMappingExclusion(accountNumber)

  await logAudit({
    userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
    action: 'budget.qb_mapping_exclusion.removed',
    metadata: { accountNumber },
  })

  return NextResponse.json({ ok: true })
}
