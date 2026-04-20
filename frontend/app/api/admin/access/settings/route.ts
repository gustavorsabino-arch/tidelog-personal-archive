import { NextRequest, NextResponse } from 'next/server'

import { saveAdminBudgetViewerSettings } from '@/lib/admin-access'
import { requireAdminAccess } from '@/lib/admin-access-control'

export const runtime = 'nodejs'

function parseYear(value: unknown): number | null {
  const year = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(year) ? year : null
}

export async function POST(req: NextRequest) {
  const accessResult = await requireAdminAccess(req)
  if (!accessResult.ok) return accessResult.response

  const body = await req.json().catch(() => null)
  const year = parseYear(body?.year)
  if (year === null) {
    return NextResponse.json({ error: 'Year is required.' }, { status: 400 })
  }

  if (!Array.isArray(body?.viewerMonthNumbers)) {
    return NextResponse.json({ error: 'viewerMonthNumbers must be an array.' }, { status: 400 })
  }

  try {
    const settings = await saveAdminBudgetViewerSettings(year, body.viewerMonthNumbers)
    return NextResponse.json({ settings })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save budget access settings.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
