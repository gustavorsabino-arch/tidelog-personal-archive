import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { requireBudgetTabAccess } from '@/lib/budget/access-control'
import { validateBudgetQbMappingRows } from '@/lib/budget/qb-mapping'
import {
  loadBudgetQbMappingState,
  saveBudgetQbMappingRows,
} from '@/lib/budget/qb-mapping-db'
import type { BudgetQbMappingMutationResult, BudgetQbMappingState } from '@/lib/budget/types'

export const runtime = 'nodejs'

function parseYear(req: NextRequest, bodyYear?: unknown): number | null {
  const raw = bodyYear ?? req.nextUrl.searchParams.get('year') ?? '2026'
  const year = Number.parseInt(String(raw), 10)
  return Number.isFinite(year) ? year : null
}

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'mapping')
  if (!accessResult.ok) return accessResult.response

  const year = parseYear(req)
  if (year === null) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  const mapping = await loadBudgetQbMappingState(year, req.nextUrl.searchParams.get('fresh') === '1')
  return NextResponse.json(mapping)
}

export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'mapping')
  if (!accessResult.ok) return accessResult.response

  const body = await req.json().catch(() => null)
  const year = parseYear(req, body?.year)
  if (year === null) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  if (!Array.isArray(body?.rows)) {
    return NextResponse.json({ error: 'Expected rows to be an array.' }, { status: 400 })
  }

  try {
    const rows = validateBudgetQbMappingRows(body.rows)
    await saveBudgetQbMappingRows(rows)

    await logAudit({
      userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
      action: 'budget.qb_mapping.updated',
      metadata: { year, rowCount: rows.length },
    })

    const nextState: BudgetQbMappingState = {
      version: 1,
      year,
      rows,
      source: 'data-branch',
      lastUpdatedAt: new Date().toISOString(),
    }
    const response: BudgetQbMappingMutationResult = {
      success: true,
      year,
      mapping: nextState,
    }
    return NextResponse.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid mapping payload'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
