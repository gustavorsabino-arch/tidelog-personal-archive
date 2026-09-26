import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import { buildBudgetImportTemplateWorkbook } from '@/lib/budget/import-template'

export const runtime = 'nodejs'

// GET /api/budget/import/template — download the blank budget import workbook
// (one sheet per department, Jan–Dec columns, line items pre-filled). Operators
// fill in the numbers and upload it back through the import modal.
export async function GET(req: NextRequest) {
  const access = await requireBudgetAccess(req, { requirement: 'import' })
  if (!access.ok) return access.response

  const buffer = buildBudgetImportTemplateWorkbook()
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="budget-import-template.xlsx"',
    },
  })
}
