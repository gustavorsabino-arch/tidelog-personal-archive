import { NextRequest, NextResponse } from 'next/server'

import { BUDGET_DEPTS } from '@/lib/constants'
import { requireBudgetAccess } from '@/lib/budget/access-control'
import {
  describeBudgetImportWorkbookRequirements,
  formatBudgetPeriodLabel,
  getBudgetImportExistingPeriodsToReplace,
  getBudgetDepartmentPlanPath,
  mergeDepartmentPeriods,
  parseBudgetWorkbook,
  prepareDepartmentPlanForImport,
  toBudgetPeriodKey,
} from '@/lib/budget/import'
import type { BudgetDepartment, BudgetDepartmentPlan, BudgetImportMeta } from '@/lib/budget/types'
import { readDataFileStrict, writeDataFile } from '@/lib/github'

export const runtime = 'nodejs'

function isBudgetDepartment(value: string): value is BudgetDepartment {
  return (BUDGET_DEPTS as readonly string[]).includes(value)
}

export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'import' })
  if (!accessResult.ok) return accessResult.response

  const formData = await req.formData()

  const file = formData.get('file')
  const yearValue = formData.get('year')
  const periodValue = formData.get('period')
  const departmentValue = formData.get('department')
  const overwriteValue = formData.get('overwrite')

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

    const existingDepartments: BudgetDepartment[] = []
    const existingPlans = await Promise.all(
      workbook.departments.map(async ({ department: dept }) => {
        const path = getBudgetDepartmentPlanPath(year, dept)
        const result = await readDataFileStrict<BudgetDepartmentPlan>(path, true)
        const plan = result.ok && result.found ? result.data : null
        const entry = workbook.departments.find((candidate) => candidate.department === dept)
        const hasExistingImportedPeriods = entry
          ? getBudgetImportExistingPeriodsToReplace(plan, entry).length > 0
          : false

        if (hasExistingImportedPeriods) {
          existingDepartments.push(dept)
        }
        return [dept, plan] as const
      }),
    )

    if (existingDepartments.length > 0 && overwriteValue !== 'true') {
      return NextResponse.json(
        {
          error: 'Existing budget data found',
          needsConfirmation: true,
          existingDepartments,
          message: `Budget already exists for ${existingDepartments.join(', ')} in ${year} (${formatBudgetPeriodLabel(period)}). Do you want to overwrite?`,
        },
        { status: 409 },
      )
    }

    const importMeta: BudgetImportMeta = {
      lastImportedAt: new Date().toISOString(),
      lastImportedBy: accessResult.user.email,
      sourceFileName: file.name,
      templateVersion: 'budget-v1-sheet',
    }

    const existingPlanByDepartment = new Map(existingPlans)
    const writeResults = await Promise.all(
      workbook.departments.map(async (entry) => {
        const preparedPlan = prepareDepartmentPlanForImport(existingPlanByDepartment.get(entry.department) ?? null, entry)
        const nextPlan = mergeDepartmentPeriods(preparedPlan, {
          year,
          department: entry.department,
          periods: entry.periods,
          importMeta,
        })

        if (!nextPlan) {
          return {
            department: entry.department,
            importedPeriods: entry.importedPeriods,
            ok: false,
            rowsProcessed: entry.rowsProcessed,
            keysImported: entry.keysImported,
            unmappedLineItems: entry.unmappedLineItems,
          }
        }

        const ok = await writeDataFile(
          getBudgetDepartmentPlanPath(year, entry.department),
          nextPlan,
          `budget: import ${entry.department} ${year} ${period}`,
        )

        return {
          department: entry.department,
          importedPeriods: entry.importedPeriods,
          ok,
          rowsProcessed: entry.rowsProcessed,
          keysImported: entry.keysImported,
          unmappedLineItems: entry.unmappedLineItems,
        }
      }),
    )

    const failed = writeResults.filter((result) => !result.ok).map((result) => result.department)
    if (failed.length > 0) {
      return NextResponse.json(
        {
          error: 'Failed to persist imported budget data',
          failedDepartments: failed,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      mode: 'import',
      year,
      period,
      importedPeriods: Array.from(new Set(writeResults.flatMap((result) => result.importedPeriods))).sort(),
      departmentsProcessed: writeResults.map((result) => result.department),
      departmentsMissing: workbook.departmentsMissing,
      existingDepartments,
      totalRows: writeResults.reduce((sum, result) => sum + result.rowsProcessed, 0),
      totalKeys: writeResults.reduce((sum, result) => sum + result.keysImported, 0),
      unmappedLineItems: Array.from(new Set(writeResults.flatMap((result) => result.unmappedLineItems))).sort(),
      importedAt: importMeta.lastImportedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Import failed', detail: message }, { status: 500 })
  }
}
