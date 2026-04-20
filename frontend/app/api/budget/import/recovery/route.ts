import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import { clearDepartmentPeriods, getBudgetDepartmentPlanPath, toBudgetPeriodKey } from '@/lib/budget/import'
import type { BudgetDepartment, BudgetDepartmentPlan, BudgetImportRecoveryInfo, BudgetPeriodKey } from '@/lib/budget/types'
import { BUDGET_DEPTS } from '@/lib/constants'
import { deleteDataFile, listDataFileHistory, readDataFileAtRefStrict, readDataFileStrict, writeDataFile } from '@/lib/github'

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

  const filePath = getBudgetDepartmentPlanPath(year, departmentValue)
  const [planResult, rawHistory] = await Promise.all([
    readDataFileStrict<BudgetDepartmentPlan>(filePath, true),
    listDataFileHistory(filePath, 10),
  ])

  const plan = planResult.ok && planResult.found ? planResult.data : null
  const history = await Promise.all(
    rawHistory.map(async (entry, index) => {
      const isCurrent = index === 0
      if (isCurrent) {
        return {
          ...entry,
          isCurrent,
          restorable: false,
        }
      }

      const version = await readDataFileAtRefStrict<BudgetDepartmentPlan>(filePath, entry.sha, true)
      return {
        ...entry,
        isCurrent,
        restorable: version.ok && version.found,
      }
    }),
  )

  const info: BudgetImportRecoveryInfo = {
    year,
    department: departmentValue,
    filePath,
    hasImportedPlan: Boolean(plan),
    periods: plan ? (Object.keys(plan.periods).sort() as BudgetImportRecoveryInfo['periods']) : [],
    importMeta: plan?.importMeta ?? null,
    history,
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

  const filePath = getBudgetDepartmentPlanPath(year, departmentValue)

  if (action === 'reset-department') {
    const ok = await deleteDataFile(filePath, `budget: reset ${departmentValue} ${year}`)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to reset the imported department plan' }, { status: 500 })
    }

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

    const existing = await readDataFileStrict<BudgetDepartmentPlan>(filePath, true)
    if (!existing.ok || !existing.found) {
      return NextResponse.json({ error: 'No imported plan found for that department.' }, { status: 404 })
    }

    const missingPeriods = periods.filter((period: BudgetPeriodKey) => !existing.data.periods?.[period])
    if (missingPeriods.length > 0) {
      return NextResponse.json(
        { error: `Some selected periods are not currently imported: ${missingPeriods.join(', ')}` },
        { status: 404 },
      )
    }

    const nextPlan = clearDepartmentPeriods(existing.data, periods)
    const ok = nextPlan
      ? await writeDataFile(filePath, nextPlan, `budget: clear ${departmentValue} ${year} ${periods.join(',')}`)
      : await deleteDataFile(filePath, `budget: clear ${departmentValue} ${year} ${periods.join(',')}`)

    if (!ok) {
      return NextResponse.json({ error: 'Failed to clear imported periods' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      action,
      year,
      department: departmentValue,
      periods,
      deletedFile: nextPlan === null,
    })
  }

  if (action === 'restore-version' || action === 'revert-last-import') {
    const history = await listDataFileHistory(filePath, 5)
    if (history.length === 0) {
      return NextResponse.json({ error: 'No imported history was found for that department.' }, { status: 404 })
    }

    const targetSha =
      action === 'restore-version'
        ? (typeof body?.sha === 'string' ? body.sha.trim() : '')
        : (history[1]?.sha ?? '')

    if (!targetSha) {
      return NextResponse.json({ error: 'Select a restorable history version.' }, { status: 400 })
    }

    const previous = await readDataFileAtRefStrict<BudgetDepartmentPlan>(filePath, targetSha, true)
    if (!previous.ok || !previous.found) {
      return NextResponse.json({ error: 'The selected history version does not contain a restorable budget file.' }, { status: 400 })
    }

    const ok = await writeDataFile(
      filePath,
      previous.data,
      `budget: restore ${departmentValue} ${year} -> ${targetSha.slice(0, 7)}`,
    )

    if (!ok) {
      return NextResponse.json({ error: 'Failed to restore the selected budget version' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      action,
      year,
      department: departmentValue,
      restoredCommitSha: targetSha,
      deletedFile: false,
    })
  }

  return NextResponse.json({ error: 'Invalid recovery action' }, { status: 400 })
}
