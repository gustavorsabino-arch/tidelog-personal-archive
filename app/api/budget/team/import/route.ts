import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { requireBudgetAccess } from '@/lib/budget/access-control'
import { buildTeamImportPlan, parseTeamMasterWorkbook, type TeamImportOp } from '@/lib/budget/team-import'
import {
  createBudgetTeamMemberInDb,
  loadBudgetTeamState,
  updateBudgetTeamMemberInDb,
  validateBudgetTeamMemberInput,
} from '@/lib/budget/team'
import type { BudgetMonthKey } from '@/lib/budget/types'

export const runtime = 'nodejs'

function currentMonthKey(): BudgetMonthKey {
  return String(new Date().getMonth() + 1).padStart(2, '0') as BudgetMonthKey
}

// POST /api/budget/team/import (admin)
//
// multipart (file)          → PREVIEW: parse the MASTER workbook's first
//                             numbered block, diff against the current roster,
//                             return the proposed ops. Nothing is written.
// json { apply: true, ops } → APPLY: execute the operator-approved ops
//                             (create / update / deactivate), audited.
export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'manage-team' })
  if (!accessResult.ok) return accessResult.response

  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      return NextResponse.json({ error: 'Upload the Team Tracker MASTER .xlsx workbook.' }, { status: 400 })
    }

    const rows = parseTeamMasterWorkbook(await file.arrayBuffer())
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Could not find the numbered team block. Expected the MASTER sheet with Current/Status/Name headers.' },
        { status: 422 },
      )
    }

    const team = await loadBudgetTeamState(new Date().getFullYear())
    const { ops } = buildTeamImportPlan(rows, team.members, currentMonthKey())
    return NextResponse.json({ rowsParsed: rows.length, ops })
  }

  const body = await req.json().catch(() => null)
  if (!body || body.apply !== true || !Array.isArray(body.ops)) {
    return NextResponse.json({ error: 'Expected { apply: true, ops: [...] }' }, { status: 400 })
  }

  const summary = { added: 0, updated: 0, deactivated: 0 }
  try {
    for (const raw of body.ops as TeamImportOp[]) {
      const input = validateBudgetTeamMemberInput(raw?.input)
      if (raw.type === 'add') {
        await createBudgetTeamMemberInDb(input)
        summary.added += 1
      } else if (raw.type === 'update' || raw.type === 'deactivate') {
        if (typeof raw.memberId !== 'string' || !raw.memberId) {
          return NextResponse.json({ error: 'memberId required for update/deactivate ops' }, { status: 400 })
        }
        await updateBudgetTeamMemberInDb(raw.memberId, input)
        if (raw.type === 'deactivate') summary.deactivated += 1
        else summary.updated += 1
      } else {
        return NextResponse.json({ error: `Unknown op type: ${String((raw as { type?: unknown }).type)}` }, { status: 400 })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Team import failed: ${message}` }, { status: 400 })
  }

  await logAudit({
    userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
    action: 'budget.team.imported',
    metadata: { ...summary, actor: accessResult.user.email },
  })

  return NextResponse.json({ ok: true, ...summary })
}
