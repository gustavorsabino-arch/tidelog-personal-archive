import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import { loadQboStatuses } from '@/lib/qb/status'

export const runtime = 'nodejs'

// QB connection details (realm IDs, refresh metadata) are admin-only — viewers
// have no UI to act on them and shouldn't see them on the wire.
export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'overview' })
  if (!accessResult.ok) return accessResult.response

  try {
    return NextResponse.json({ entities: await loadQboStatuses() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load QuickBooks status'
    return NextResponse.json({ error: 'Failed to load QuickBooks status', detail: message }, { status: 503 })
  }
}
