import { BUDGET_DEPTS } from '../constants.ts'
import { formatBudgetDepartmentList, getBudgetDepartmentLabel } from './departments.ts'
import type { BudgetDepartment } from './types.ts'

export const BUDGET_IMPORT_IGNORED_SHEET_NAMES = ['Sheet1'] as const
export const BUDGET_IMPORT_FALLBACK_SHEET_NAMES = ['BudgetbyMonth', 'BudgetByMonth', 'Budget', 'Sheet1'] as const
export const BUDGET_IMPORT_SHEET_ALIASES: Record<string, BudgetDepartment> = {
  // Accept the v2-era long name on imported workbook sheets and map it back to the
  // canonical 'Finance' department.
  'Finance & Accounting': 'Finance',
}
export const BUDGET_IMPORT_MONTH_HEADER_SCAN_LIMIT = 10
export const BUDGET_IMPORT_MIN_MONTH_HEADERS = 3

export type BudgetImportWorkbookGuide = {
  department: BudgetDepartment | 'All'
  workbookCount: number
  requiredDepartmentSheets: readonly BudgetDepartment[]
  ignoredSheetNames: readonly string[]
  fallbackSheetNames: readonly string[]
  sheetAliases: ReadonlyArray<{ sheetName: string; department: BudgetDepartment }>
  monthHeaderScanLimit: number
  minimumMonthHeaders: number
  primaryLineItemColumn: 'C'
  fallbackLineItemColumn: 'B'
}

const SHARED_WORKBOOK_GUIDE: Omit<BudgetImportWorkbookGuide, 'department'> = {
  workbookCount: 1,
  requiredDepartmentSheets: BUDGET_DEPTS,
  ignoredSheetNames: BUDGET_IMPORT_IGNORED_SHEET_NAMES,
  fallbackSheetNames: BUDGET_IMPORT_FALLBACK_SHEET_NAMES,
  sheetAliases: Object.entries(BUDGET_IMPORT_SHEET_ALIASES).map(([sheetName, department]) => ({
    sheetName,
    department,
  })),
  monthHeaderScanLimit: BUDGET_IMPORT_MONTH_HEADER_SCAN_LIMIT,
  minimumMonthHeaders: BUDGET_IMPORT_MIN_MONTH_HEADERS,
  primaryLineItemColumn: 'C',
  fallbackLineItemColumn: 'B',
}

export function getBudgetImportWorkbookGuide(
  department: BudgetDepartment | 'All',
): BudgetImportWorkbookGuide {
  return {
    department,
    ...SHARED_WORKBOOK_GUIDE,
  }
}

export function describeBudgetImportWorkbookRequirements(
  department: BudgetDepartment | 'All',
): string {
  const guide = getBudgetImportWorkbookGuide(department)
  const aliases = guide.sheetAliases
    .map(({ sheetName, department: mappedDepartment }) => `${sheetName} for ${getBudgetDepartmentLabel(mappedDepartment)}`)
    .join(', ')
  const sharedLayout =
    `Month headers such as Jan-Dec must appear within the first ${guide.monthHeaderScanLimit} rows, ` +
    `line items are read from column ${guide.primaryLineItemColumn} with column ${guide.fallbackLineItemColumn} as a fallback, and total rows are ignored.`

  if (department === 'All') {
    return (
      `Upload one Excel workbook with ${guide.requiredDepartmentSheets.length} department sheets: ` +
      `${formatBudgetDepartmentList(guide.requiredDepartmentSheets)}. ` +
      `${aliases ? `Legacy aliases are accepted, including ${aliases}. ` : ''}` +
      sharedLayout
    )
  }

  return (
    `Upload one Excel workbook for ${getBudgetDepartmentLabel(department)}. ` +
    `It can use a sheet named ${getBudgetDepartmentLabel(department)}, a legacy alias such as ${aliases}, ` +
    `or a single fallback sheet named ${guide.fallbackSheetNames.join(', ')}. ` +
    `If there is no summary sheet, the workbook may also be split across multiple budget-category tabs for that one department. ` +
    sharedLayout
  )
}
