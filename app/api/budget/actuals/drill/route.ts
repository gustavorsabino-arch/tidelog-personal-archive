import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import { parseBudgetViewFromSearchParams } from '@/lib/budget/api-view'
import { fetchBudgetActualDrill } from '@/lib/budget/qb-actual-drill'
import { isBudgetDepartmentActualScope } from '@/lib/budget/qb-class'
import type { BudgetReportColumnKey } from '@/lib/budget/types'

export const runtime = 'nodejs'

function parseColumn(value: string | null): BudgetReportColumnKey | null {
  if (value === 'period' || value === 'ytd' || value === 'annual') return value
  return null
}

function parseLineKeys(value: string | null): string[] {
  return Array.from(new Set(
    String(value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  ))
}

export async function GET(req: NextRequest) {
  const column = parseColumn(req.nextUrl.searchParams.get('column'))
  if (!column) {
    return NextResponse.json({ error: 'A valid report column is required.' }, { status: 400 })
  }

  const lineKeys = parseLineKeys(req.nextUrl.searchParams.get('keys'))
  if (lineKeys.length === 0) {
    return NextResponse.json({ error: 'At least one report line key is required.' }, { status: 400 })
  }

  const rawDepartment = req.nextUrl.searchParams.get('department')
  if (rawDepartment && !isBudgetDepartmentActualScope(rawDepartment)) {
    return NextResponse.json({ error: 'A valid budget department is required.' }, { status: 400 })
  }
  const department = rawDepartment && isBudgetDepartmentActualScope(rawDepartment)
    ? rawDepartment
    : null

  const accessResult = department && department !== 'Not specified'
    ? await requireBudgetAccess(req, { department })
    : await requireBudgetAccess(req, { requirement: 'overview' })
  if (!accessResult.ok) return accessResult.response

  try {
    const view = parseBudgetViewFromSearchParams(req.nextUrl.searchParams)
    const drill = await fetchBudgetActualDrill(view, column, lineKeys, department)
    return NextResponse.json(drill)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch QuickBooks drill-down.'
    const status =
      message.includes('not connected') ? 409
        : message.includes('not configured') ? 503
          : 500
    return NextResponse.json({ error: message }, { status })
  }
}
