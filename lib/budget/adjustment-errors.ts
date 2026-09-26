import { NextResponse } from 'next/server'

const MISSING_TABLE = /relation .*budget_adjustment.* does not exist|42P01/i

/**
 * Turn a budget-adjustment DB failure into a legible JSON response. A missing
 * table (self-heal couldn't create it, e.g. no CREATE privilege) is a setup
 * problem, so it gets 503 with a fix-it hint instead of an opaque 500.
 */
export function budgetAdjustmentErrorResponse(error: unknown, action: string): NextResponse {
  const message = error instanceof Error ? error.message : String(error)
  if (MISSING_TABLE.test(message)) {
    return NextResponse.json(
      { error: 'The budget_adjustment table is not set up yet. Run the database migration (bun run db:migrate).' },
      { status: 503 },
    )
  }
  console.error(`[budget/adjustments] ${action} failed`, error)
  return NextResponse.json({ error: `Failed to ${action} adjustment: ${message}` }, { status: 500 })
}
