import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { requireBudgetAccess } from '@/lib/budget/access-control'
import { getBudgetDepartmentPlanPath, toBudgetPeriodKey } from '@/lib/budget/import'
import { deleteBudgetDepartmentPlan, loadBudgetDepartmentPlan } from '@/lib/budget/source'
import type { BudgetDepartment, BudgetImportRecoveryInfo, BudgetPeriodKey } from '@/lib/budget/types'
import { BUDGET_DEPTS } from '@/lib/constants'

export const runtime = 'nodejs'

function isBudgetDepartment(value: string): value is BudgetDepartment {
  return (BUDGET_DEPTS as readonly string[]).includes(value)
}

async function requireBudgetImportAccess(req: NextRequest) {
  return requireBudgetAccess(req, { requirement: 'import' })
}

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetImportAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = Number.parseInt(req.nextUrl.searchParams.get('year') ?? '2026', 10)
  const departmentValue = req.nextUrl.searchParams.get('department') ?? ''
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  if (!isBudgetDepartment(departmentValue)) {
    return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
  }

  const plan = await loadBudgetDepartmentPlan(year, departmentValue)

  const info: BudgetImportRecoveryInfo = {
    year,
    department: departmentValue,
    filePath: getBudgetDepartmentPlanPath(year, departmentValue),
    hasImportedPlan: Boolean(plan),
    periods: plan ? (Object.keys(plan.periods).sort() as BudgetImportRecoveryInfo['periods']) : [],
    importMeta: plan?.importMeta ?? null,
    history: [],
  }

  return NextResponse.json(info)
}

export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetImportAccess(req)
  if (!accessResult.ok) return accessResult.response

  const body = await req.json().catch(() => null)
  const action = typeof body?.action === 'string' ? body.action : ''
  const year = Number.parseInt(String(body?.year ?? '2026'), 10)
  const departmentValue = typeof body?.department === 'string' ? body.department : ''

  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  if (!isBudgetDepartment(departmentValue)) {
    return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
  }

  const user = accessResult.user

  if (action === 'reset-department') {
    const removed = await deleteBudgetDepartmentPlan(year, departmentValue)
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'budget.recovery.reset-department',
      metadata: { year, department: departmentValue, removedRows: removed },
    })
    return NextResponse.json({
      success: true,
      action,
      year,
      department: departmentValue,
      deletedFile: true,
    })
  }

  if (action === 'clear-periods' || action === 'clear-period') {
    const rawPeriods: unknown[] = Array.isArray(body?.periods)
      ? body.periods
      : body?.period
        ? [body.period]
        : []

    const periods = rawPeriods
      .map((value: unknown) => toBudgetPeriodKey(String(value ?? '')))
      .filter((value): value is BudgetPeriodKey => value !== null)

    if (!periods.length) {
      return NextResponse.json({ error: 'Select at least one imported period.' }, { status: 400 })
    }

    const plan = await loadBudgetDepartmentPlan(year, departmentValue)
    if (!plan) {
      return NextResponse.json({ error: 'No imported plan found for that department.' }, { status: 404 })
    }

    const missingPeriods = periods.filter((period) => !plan.periods?.[period])
    if (missingPeriods.length > 0) {
      return NextResponse.json(
        { error: `Some selected periods are not currently imported: ${missingPeriods.join(', ')}` },
        { status: 404 },
      )
    }

    const removed = await deleteBudgetDepartmentPlan(year, departmentValue)
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'budget.recovery.clear-periods',
      metadata: { year, department: departmentValue, periods, removedRows: removed },
    })

    return NextResponse.json({
      success: true,
      action,
      year,
      department: departmentValue,
      periods,
      deletedFile: true,
    })
  }

  if (action === 'restore-version' || action === 'revert-last-import') {
    return NextResponse.json(
      {
        error: 'Version history is not available after the v2 rebuild; imports are now DB-backed.',
      },
      { status: 501 },
    )
  }

  return NextResponse.json({ error: 'Invalid recovery action' }, { status: 400 })
}
