// Generates the Budget import template workbook (.xlsx) that operators fill in
// and upload. The layout matches what parseBudgetWorkbook expects so the file
// round-trips: one sheet per department, month headers (Jan–Dec) in the header
// row, category header rows in column B, and line-item labels in column C.

import * as XLSX from 'xlsx'

import { BUDGET_DEPTS } from '../constants.ts'
import { BUDGET_TEMPLATE_LINE_SPECS } from './reports.ts'

export const TEMPLATE_MONTH_HEADERS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// Rows for one department sheet. Months live in columns D..O (index 3+), the
// category label in column B (index 1), and the line-item label in column C
// (index 2) — the columns parseBudgetWorkbook reads.
export function buildBudgetImportTemplateRows(): (string | number)[][] {
  const blanks = TEMPLATE_MONTH_HEADERS.map(() => '')
  const rows: (string | number)[][] = []
  rows.push(['', '', '', ...TEMPLATE_MONTH_HEADERS])
  let lastCategory = ''
  for (const spec of BUDGET_TEMPLATE_LINE_SPECS) {
    if (spec.category !== lastCategory) {
      rows.push(['', spec.category, '', ...blanks])
      lastCategory = spec.category
    }
    rows.push(['', '', spec.label, ...blanks])
  }
  return rows
}

export function buildBudgetImportTemplateWorkbook(): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  const rows = buildBudgetImportTemplateRows()
  for (const dept of BUDGET_DEPTS) {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, dept)
  }
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
