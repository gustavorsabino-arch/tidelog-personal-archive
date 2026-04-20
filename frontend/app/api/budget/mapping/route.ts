import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetTabAccess } from '@/lib/budget/access-control'
import { getBudgetQbMappingPath, loadBudgetQbMappingState, validateBudgetQbMappingRows } from '@/lib/budget/qb-mapping'
import type { BudgetQbMappingMutationResult, BudgetQbMappingState } from '@/lib/budget/types'
import { writeDataFile } from '@/lib/github'

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
    const nextState: BudgetQbMappingState = {
      version: 1,
      year,
      rows,
      source: 'data-branch',
      lastUpdatedAt: new Date().toISOString(),
    }

    const ok = await writeDataFile(
      getBudgetQbMappingPath(year),
      nextState,
      `budget: update qb mapping ${year}`,
    )

    if (!ok) {
      return NextResponse.json({ error: 'Failed to persist the QB mapping.' }, { status: 500 })
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
