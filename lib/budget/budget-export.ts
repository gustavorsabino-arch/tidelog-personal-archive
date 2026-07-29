import * as XLSX from 'xlsx'
import type { BudgetReportTableModel } from './types.ts'

/**
 * Serialize the current on-screen budget report to an .xlsx workbook.
 *
 * The passed `report` is the exact BudgetReportTableModel that
 * BudgetReportTable renders — already access-filtered and scoped to the
 * user's current view (year, month, department, entity). Exporting from it
 * guarantees Excel matches the screen 1:1.
 *
 * Column layout mirrors the on-screen table:
 *   Line Item | <period> Budget | Actual | Var | <ytd> Budget | Actual | Var | <annual> Budget | Actual | Var
 *
 * Number cells get the currency format '$#,##0.00'. Category and total rows
 * are rendered in the "label" column with uppercase category names and bold
 * font styling is skipped intentionally (xlsx-community's free build doesn't
 * write style records reliably; leaving cells plain preserves round-trip).
 */
export function buildBudgetWorkbook(
  report: BudgetReportTableModel,
  sheetName: string,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const safeSheetName = sanitizeSheetName(sheetName)
  XLSX.utils.book_append_sheet(wb, buildBudgetSheet(report), safeSheetName)
  return wb
}

// Excel forbids these chars in sheet names and caps length at 31 chars.
function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim()
  return cleaned.length > 31 ? cleaned.slice(0, 31) : (cleaned || 'Budget')
}

function buildBudgetSheet(report: BudgetReportTableModel): XLSX.WorkSheet {
  const header = [
    'Line Item',
    `${report.periodLabel} Budget`,
    `${report.periodLabel} Actual`,
    `${report.periodLabel} Variance`,
    `${report.ytdLabel} Budget`,
    `${report.ytdLabel} Actual`,
    `${report.ytdLabel} Variance`,
    `${report.annualLabel} Budget`,
    `${report.annualLabel} Actual`,
    `${report.annualLabel} Variance`,
  ]

  const dataRows: (string | number | null)[][] = []
  for (const row of report.rows) {
    // Categories render uppercase — matches the on-screen header banding.
    const label = row.kind === 'category' ? row.label.toUpperCase() : row.label
    dataRows.push([
      label,
      row.cells.period.budgetUsd,
      row.cells.period.actualUsd,
      row.cells.period.varianceUsd,
      row.cells.ytd.budgetUsd,
      row.cells.ytd.actualUsd,
      row.cells.ytd.varianceUsd,
      row.cells.annual.budgetUsd,
      row.cells.annual.actualUsd,
      row.cells.annual.varianceUsd,
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows])

  // Number-format every numeric cell (columns B..J = index 1..9) as USD.
  for (let r = 1; r <= dataRows.length; r++) {
    for (let c = 1; c <= 9; c++) {
      const ref = XLSX.utils.encode_cell({ c, r })
      const cell = ws[ref]
      if (cell && typeof cell.v === 'number') {
        cell.z = '$#,##0.00;-$#,##0.00'
      }
    }
  }

  // Column widths: label wide, numeric cols medium.
  ws['!cols'] = [
    { wch: 34 },
    { wch: 16 }, { wch: 16 }, { wch: 16 },
    { wch: 16 }, { wch: 16 }, { wch: 16 },
    { wch: 16 }, { wch: 16 }, { wch: 16 },
  ]

  // Freeze the header row so the top row stays put when scrolling.
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }

  return ws
}

/**
 * Build a filename that reflects the current view. Examples:
 *   tidelog-budget-legal-2026-03.xlsx
 *   tidelog-budget-all-departments-2026-may-ytd.xlsx
 *   tidelog-budget-engineering-2026-annual.xlsx
 */
export function buildBudgetExportFilename(opts: {
  department: string | null       // 'Legal' | null (null = all)
  year: number
  periodLabel: string             // e.g., 'March 2026' | 'YTD May 2026' | '2026'
}): string {
  const deptSlug = opts.department
    ? slugify(opts.department)
    : 'all-departments'
  const periodSlug = slugify(opts.periodLabel)
    .replace(new RegExp(`-?${opts.year}`), '')  // strip year — already prefixed
    .replace(/^-+|-+$/g, '')
    || 'annual'
  return `tidelog-budget-${deptSlug}-${opts.year}-${periodSlug}.xlsx`
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
