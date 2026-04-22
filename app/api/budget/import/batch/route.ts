import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { requireBudgetAccess } from '@/lib/budget/access-control'
import { normalizeBudgetDepartmentName } from '@/lib/budget/departments'
import { parseBudgetWorkbook } from '@/lib/budget/import'
import { saveBudgetDepartmentPlan } from '@/lib/budget/source'
import type { BudgetDepartment, BudgetDepartmentPlan } from '@/lib/budget/types'

export const runtime = 'nodejs'

type FileResult = {
  file: string
  department: BudgetDepartment | null
  linesImported: number
  rowsProcessed: number
  unmappedLineItems: string[]
  error: string | null
}

function stripXlsxExtension(name: string): string {
  return name.replace(/\.(xlsx|xls)$/i, '')
}

export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'import' })
  if (!accessResult.ok) return accessResult.response

  const formData = await req.formData()

  const yearValue = formData.get('year')
  const year = Number.parseInt(String(yearValue ?? '2026'), 10)
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: 'A valid year is required.' }, { status: 400 })
  }

  const rawFiles = formData.getAll('files').filter((value): value is File => value instanceof File)
  if (rawFiles.length === 0) {
    return NextResponse.json({ error: 'Upload at least one .xlsx workbook.' }, { status: 400 })
  }

  const results: FileResult[] = []

  for (const file of rawFiles) {
    const entry: FileResult = {
      file: file.name,
      department: null,
      linesImported: 0,
      rowsProcessed: 0,
      unmappedLineItems: [],
      error: null,
    }

    const lowerName = file.name.toLowerCase()
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
      entry.error = 'Not an Excel workbook; skipped.'
      results.push(entry)
      continue
    }

    const inferred = normalizeBudgetDepartmentName(stripXlsxExtension(file.name))
    if (!inferred) {
      entry.error = `Couldn\u2019t infer a budget department from "${file.name}". Rename the file to match a department name (e.g. Engineering.xlsx) and try again.`
      results.push(entry)
      continue
    }
    entry.department = inferred

    try {
      const workbook = parseBudgetWorkbook(await file.arrayBuffer(), inferred, 'annual')

      if (workbook.invalidSheets.length > 0) {
        entry.error = workbook.invalidSheets[0]?.error
          || 'Workbook format validation failed — check the BudgetByMonth sheet.'
        results.push(entry)
        continue
      }

      const departmentEntry = workbook.departments.find((candidate) => candidate.department === inferred)
      if (!departmentEntry) {
        entry.error = `No sheet in ${file.name} parsed as ${inferred}.`
        results.push(entry)
        continue
      }

      const plan: BudgetDepartmentPlan = {
        version: 1,
        year,
        department: inferred,
        periods: departmentEntry.periods,
        source: 'sheet-import',
        importMeta: {
          lastImportedAt: new Date().toISOString(),
          lastImportedBy: accessResult.user.email,
          sourceFileName: file.name,
          templateVersion: 'budget-v1-sheet',
        },
      }

      // saveBudgetDepartmentPlan DELETEs every budget_line row for (year, department)
      // before reinserting — so re-uploading the same year cleanly overwrites.
      await saveBudgetDepartmentPlan(plan)

      entry.linesImported = departmentEntry.keysImported
      entry.rowsProcessed = departmentEntry.rowsProcessed
      entry.unmappedLineItems = departmentEntry.unmappedLineItems
    } catch (err) {
      entry.error = err instanceof Error ? err.message : 'Unknown parse error'
    }

    results.push(entry)
  }

  const succeeded = results.filter((r) => !r.error)
  const failed = results.filter((r) => r.error)

  await logAudit({
    userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
    action: 'budget.imported.batch',
    metadata: {
      year,
      fileCount: rawFiles.length,
      succeeded: succeeded.map((r) => r.department),
      failed: failed.map((r) => ({ file: r.file, error: r.error })),
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: failed.length === 0,
    year,
    succeeded: succeeded.length,
    failed: failed.length,
    results,
  })
}
