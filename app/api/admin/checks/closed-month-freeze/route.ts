import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { findFrozenClosedMonths } from '@/lib/checks/closed-month-freeze'

// Read-only diagnostic (Check 2.1 Phase A). No QuickBooks calls, no writes —
// just scans qb_report_cache for closed months frozen empty. Admin-gated.
export const maxDuration = 60

export async function GET(req: Request) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const report = await findFrozenClosedMonths(new Date())
  return NextResponse.json(report)
}
