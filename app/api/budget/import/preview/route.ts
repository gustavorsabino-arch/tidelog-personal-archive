import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import {
  describeBudgetImportWorkbookRequirements,
  diffBudgetLineAmounts,
  formatBudgetPeriodLabel,
  getBudgetImportExistingPeriodsToReplace,
  parseBudgetWorkbook,
  toBudgetPeriodKey,
} from '@/lib/budget/import'
import { loadBudgetDepartmentPlan } from '@/lib/budget/source'
import type {
  BudgetDepartment,
  BudgetDepartmentPlan,
  BudgetImportPreviewDepartment,
  BudgetImportPreviewResult,
} from '@/lib/budget/types'
import { BUDGET_DEPTS } from '@/lib/constants'

export const runtime = 'nodejs'

function isBudgetDepartment(value: string): value is BudgetDepartment {
  return (BUDGET_DEPTS as readonly string[]).includes(value)
}

function sumPlanPeriods(
  plan: BudgetDepartmentPlan | null,
  periods: readonly string[],
): Record<string, number> {
  return periods.reduce<Record<string, number>>((merged, period) => {
    const lines = plan?.periods?.[period as keyof BudgetDepartmentPlan['periods']] ?? {}
    for (const [key, value] of Object.entries(lines)) {
      merged[key] = (merged[key] ?? 0) + (value ?? 0)
    }
    return merged
  }, {})
}

export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'import' })
  if (!accessResult.ok) return accessResult.response

  const formData = await req.formData()
  const file = formData.get('file')
  const yearValue = formData.get('year')
  const periodValue = formData.get('period')
  const departmentValue = formData.get('department')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const lowerName = file.name.toLowerCase()
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
    return NextResponse.json({ error: 'Invalid file type. Upload an .xlsx or .xls workbook.' }, { status: 400 })
  }

  const year = Number.parseInt(String(yearValue ?? '2026'), 10)
  const period = toBudgetPeriodKey(String(periodValue ?? 'annual'))
  const department =
    String(departmentValue ?? 'All') === 'All'
      ? 'All'
      : isBudgetDepartment(String(departmentValue))
        ? (departmentValue as BudgetDepartment)
        : null

  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: 'Year required' }, { status: 400 })
  }

  if (!period) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  }

  if (!department) {
    return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
  }

  try {
    const workbook = parseBudgetWorkbook(await file.arrayBuffer(), department, period)
    if (workbook.invalidSheets.length > 0) {
      return NextResponse.json(
        {
          error: 'Workbook format validation failed',
          detail: workbook.invalidSheets[0]?.error || 'One or more sheets do not match the expected budget template.',
          invalidSheets: workbook.invalidSheets,
          expectedWorkbook: describeBudgetImportWorkbookRequirements(department),
        },
        { status: 400 },
      )
    }

    if (workbook.departments.length === 0) {
      return NextResponse.json(
        {
          error: 'No matching department sheets found in workbook',
          departmentsMissing: workbook.departmentsMissing,
          expectedWorkbook: describeBudgetImportWorkbookRequirements(department),
        },
        { status: 400 },
      )
    }

    const preview = await Promise.all(
      workbook.departments.map(async (entry) => {
        const existingPlan = await loadBudgetDepartmentPlan(year, entry.department)
        const existingPeriods = getBudgetImportExistingPeriodsToReplace(existingPlan, entry)
        const beforeLines = sumPlanPeriods(existingPlan, existingPeriods)

        const departmentPreview: BudgetImportPreviewDepartment = {
          department: entry.department,
          rowsProcessed: entry.rowsProcessed,
          keysImported: entry.keysImported,
          unmappedLineItems: entry.unmappedLineItems,
          importedPeriods: entry.importedPeriods,
          existingPeriods,
          diff: diffBudgetLineAmounts(beforeLines, entry.lines),
        }

        return departmentPreview
      }),
    )

    const result: BudgetImportPreviewResult = {
      success: true,
      mode: 'preview',
      year,
      period,
      importedPeriods: Array.from(new Set(workbook.departments.flatMap((entry) => entry.importedPeriods))).sort(),
      departmentsProcessed: preview.map((entry) => entry.department),
      departmentsMissing: workbook.departmentsMissing,
      existingDepartments: preview.filter((entry) => entry.existingPeriods.length > 0).map((entry) => entry.department),
      preview,
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Preview failed', detail: message, periodLabel: formatBudgetPeriodLabel(period) },
      { status: 500 },
    )
  }
}
