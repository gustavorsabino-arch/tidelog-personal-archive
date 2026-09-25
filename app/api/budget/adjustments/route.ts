import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { BUDGET_DEPTS } from '@/lib/constants'
import { getAllowedBudgetDepartmentsForUser, requireBudgetAccess } from '@/lib/budget/access-control'
import { ALL_BUDGET_MONTHS } from '@/lib/budget/adjustments'
import { createBudgetAdjustment, loadBudgetAdjustments } from '@/lib/budget/adjustments-db'
import type { BudgetDepartment } from '@/lib/budget/types'

export const runtime = 'nodejs'

function isBudgetDepartment(value: unknown): value is BudgetDepartment {
  return typeof value === 'string' && (BUDGET_DEPTS as readonly string[]).includes(value)
}

// GET /api/budget/adjustments?year=YYYY[&department=Dept]
export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'view' })
  if (!accessResult.ok) return accessResult.response

  const { searchParams } = new URL(req.url)
  const year = Number.parseInt(searchParams.get('year') ?? '', 10)
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  // Scope to the departments this user may view. `null` = all (admin).
  const allowed = getAllowedBudgetDepartmentsForUser(accessResult.user)
  const requested = searchParams.get('department')
  let departments: BudgetDepartment[] | undefined
  if (requested && requested !== 'All') {
    if (!isBudgetDepartment(requested)) {
      return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
    }
    if (allowed !== null && !allowed.includes(requested)) {
      return NextResponse.json({ error: `You do not have access to ${requested}.` }, { status: 403 })
    }
    departments = [requested]
  } else if (allowed !== null) {
    departments = allowed
  }

  const adjustments = await loadBudgetAdjustments(year, departments)
  return NextResponse.json({ adjustments })
}

// POST /api/budget/adjustments  — create (admin only)
export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'import' })
  if (!accessResult.ok) return accessResult.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { year, department, lineItem, kind, amount, startPeriod } = body as Record<string, unknown>
  const durationMonths = (body as Record<string, unknown>).durationMonths
  const notes = (body as Record<string, unknown>).notes

  if (!Number.isFinite(Number(year))) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }
  if (!isBudgetDepartment(department)) {
    return NextResponse.json({ error: 'Valid department required' }, { status: 400 })
  }
  if (typeof lineItem !== 'string' || lineItem.trim().length === 0) {
    return NextResponse.json({ error: 'Line item required' }, { status: 400 })
  }
  if (kind !== 'one_time' && kind !== 'recurring') {
    return NextResponse.json({ error: "kind must be 'one_time' or 'recurring'" }, { status: 400 })
  }
  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum) || amountNum === 0) {
    return NextResponse.json({ error: 'A non-zero amount is required' }, { status: 400 })
  }
  if (typeof startPeriod !== 'string' || !ALL_BUDGET_MONTHS.includes(startPeriod as never)) {
    return NextResponse.json({ error: 'startPeriod must be a month 01-12' }, { status: 400 })
  }
  const duration = kind === 'recurring' ? Number(durationMonths) : 1
  if (kind === 'recurring' && (!Number.isFinite(duration) || duration < 1)) {
    return NextResponse.json({ error: 'durationMonths must be >= 1 for a recurring adjustment' }, { status: 400 })
  }
  if (typeof notes !== 'string' || notes.trim().length === 0) {
    return NextResponse.json({ error: 'Notes are required — say why you are adjusting' }, { status: 400 })
  }

  let created: { id: string }
  try {
    created = await createBudgetAdjustment({
      year: Number(year),
      department,
      lineItem: lineItem.trim(),
      kind,
      amount: amountNum,
      startPeriod: startPeriod as never,
      durationMonths: duration,
      notes: notes.trim(),
      createdBy: accessResult.user.email,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // The most common failure right after deploy: the table hasn't been created
    // yet because migrations don't run on build. Surface a clear, actionable
    // message instead of an opaque 500.
    if (/relation .*budget_adjustment.* does not exist|42P01/i.test(message)) {
      return NextResponse.json(
        { error: 'The budget_adjustment table is not set up yet. Run the database migration (bun run db:migrate).' },
        { status: 503 },
      )
    }
    console.error('[budget/adjustments] create failed', error)
    return NextResponse.json({ error: `Failed to save adjustment: ${message}` }, { status: 500 })
  }

  await logAudit({
    userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
    action: 'budget.adjustment.created',
    metadata: { id: created.id, year: Number(year), department, lineItem, kind, amount: amountNum, startPeriod, durationMonths: duration },
  })

  return NextResponse.json({ ok: true, id: created.id })
}
