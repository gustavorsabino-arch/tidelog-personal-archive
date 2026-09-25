import * as XLSX from 'xlsx'

import { BUDGET_DEPTS } from '../constants.ts'
import {
  BUDGET_LINE_CATALOG,
  BUDGET_LINE_ENTRY_BY_KEY,
  normalizeBudgetLineAmounts,
  normalizeBudgetLineKey,
  type BudgetLineKey,
} from './catalog.ts'
import {
  BUDGET_IMPORT_IGNORED_SHEET_NAMES,
  BUDGET_IMPORT_FALLBACK_SHEET_NAMES,
  BUDGET_IMPORT_MIN_MONTH_HEADERS,
  BUDGET_IMPORT_MONTH_HEADER_SCAN_LIMIT,
  BUDGET_IMPORT_SHEET_ALIASES,
  describeBudgetImportWorkbookRequirements,
} from './import-spec.ts'
import type {
  BudgetDepartment,
  BudgetDepartmentPlan,
  BudgetLineDiffEntry,
  BudgetImportMeta,
  BudgetLineAmounts,
  BudgetMonthKey,
  BudgetPeriodKey,
} from './types.ts'

const FALLBACK_START_ROW_INDEX = 6
const FALLBACK_LINE_COLUMN_INDEX = 2
const FALLBACK_VALUE_COLUMN_INDEX = 3
const MIN_RECOGNIZED_KEYS_WITHOUT_HEADERS = 2
const MIN_PARSED_ROWS_WITHOUT_HEADERS = 2
const ALL_BUDGET_MONTH_KEYS: BudgetMonthKey[] = [
  '01', '02', '03', '04', '05', '06',
  '07', '08', '09', '10', '11', '12',
]
const MONTH_LABEL_TO_KEY: Record<string, BudgetMonthKey> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
}
const SHEET_TO_DEPARTMENT: Record<string, BudgetDepartment> = Object.fromEntries(
  Object.entries(BUDGET_IMPORT_SHEET_ALIASES).map(([sheetName, department]) => [sheetName.trim().toLowerCase(), department]),
)

const LINE_ITEM_ALIASES: Record<string, BudgetLineKey> = {
  'salaries & wages': 'salary',
  salary: 'salary',
  bonus: 'bonus',
  commissions: 'commissions',
  benefits: 'benefits',
  'payroll taxes': 'payroll',
  'severance pay': 'severance',
  'business tools': 'bizTools',
  'company tools': 'bizTools',
  'department tools': 'epdTools',
  'cloud hosting & compute': 'hosting',
  'cloud hosting and compute': 'hosting',
  'blockchain & rpc': 'blockchainRpc',
  'security & monitoring': 'securityMon',
  'third-party & referrals': 'recruiting',
  'third party & referrals': 'recruiting',
  'events': 'meals',
  'other': 'mktExp',
  'travel': 'travel',
  'travel & entertainment': 'travel',
  'professional services': 'profSvc',
  'entity compliance': 'corpCompliance',
  'compliance': 'corpCompliance',
  'corporate compliance': 'corpCompliance',
  'corporate fees': 'corpFees',
  lobbying: 'lobbying',
  'bank fees': 'bankFees',
  'transaction fees': 'bankFees',
  'market maker fees': 'mmFees',
  'office': 'rent',
  'misc expenses': 'hardware',
  'hardware': 'hardware',
  'hardware / misc': 'hardware',
  'industry relations': 'industryRelations',
  'contingency': 'contingency',
}

for (const entry of BUDGET_LINE_CATALOG) {
  LINE_ITEM_ALIASES[normalizeLineItem(entry.label)] = entry.key
}

function normalizeLineItem(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function slugifyDepartment(department: BudgetDepartment): string {
  return department.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function sortBudgetPeriodKeys(periods: readonly BudgetPeriodKey[]): BudgetPeriodKey[] {
  return [...periods].sort((left, right) => {
    if (left === 'annual') return -1
    if (right === 'annual') return 1
    return left.localeCompare(right)
  })
}

function sortBudgetMonthKeys(periods: readonly BudgetMonthKey[]): BudgetMonthKey[] {
  return [...periods].sort((left, right) => left.localeCompare(right)) as BudgetMonthKey[]
}

function mergeBudgetLineAmounts(
  target: BudgetLineAmounts,
  source: BudgetLineAmounts,
): BudgetLineAmounts {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (value ?? 0)
  }

  return target
}

function isPopulatedCell(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

function summarizeImportedPeriods(
  periods: Partial<Record<BudgetPeriodKey, BudgetLineAmounts>>,
  importedPeriods: readonly BudgetPeriodKey[],
): BudgetLineAmounts {
  const lines: BudgetLineAmounts = {}

  for (const period of importedPeriods) {
    const periodLines = normalizeBudgetLineAmounts(periods[period] ?? {})
    for (const [key, value] of Object.entries(periodLines)) {
      lines[key] = (lines[key] ?? 0) + (value ?? 0)
    }
  }

  return lines
}

export function getBudgetDepartmentPlanPath(year: number | string, department: BudgetDepartment): string {
  return `budget/${year}/plan/${slugifyDepartment(department)}.json`
}

export function parseBudgetLineKey(lineItemName: string): string {
  const normalized = normalizeLineItem(lineItemName)
  if (!normalized) return ''

  const aliasMatch = LINE_ITEM_ALIASES[normalized]
  if (aliasMatch) return aliasMatch

  for (const [alias, key] of Object.entries(LINE_ITEM_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) return key
  }

  return normalizeBudgetLineKey(lineItemName)
}

export function formatBudgetLineLabel(key: string): string {
  return BUDGET_LINE_ENTRY_BY_KEY[key]?.label
    ?? key
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
}

function parseNumericCell(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const cleaned = value.replace(/[$,\s]/g, '')
  if (!cleaned) return null

  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function detectSheetLayout(rows: unknown[][]): {
  startRow: number
  lineColumn: number
  valueColumn: number
  detectedFromHeaders: boolean
} {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    let lineColumn = -1
    let valueColumn = -1

    row.forEach((cell, cellIndex) => {
      if (typeof cell !== 'string') return
      const normalized = normalizeLineItem(cell)
      if (normalized === 'line item' || normalized === 'line_item') lineColumn = cellIndex
      if (normalized === 'budget' || normalized === 'annual budget') valueColumn = cellIndex
    })

    if (lineColumn >= 0 && valueColumn >= 0) {
      return {
        startRow: rowIndex + 1,
        lineColumn,
        valueColumn,
        detectedFromHeaders: true,
      }
    }
  }

  return {
    startRow: FALLBACK_START_ROW_INDEX,
    lineColumn: FALLBACK_LINE_COLUMN_INDEX,
    valueColumn: FALLBACK_VALUE_COLUMN_INDEX,
    detectedFromHeaders: false,
  }
}

function detectMonthColumns(rows: unknown[][]): {
  monthCols: Partial<Record<BudgetMonthKey, number>>
  monthRowIndex: number
} | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, BUDGET_IMPORT_MONTH_HEADER_SCAN_LIMIT); rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    const monthCols: Partial<Record<BudgetMonthKey, number>> = {}

    row.forEach((cell, cellIndex) => {
      if (typeof cell !== 'string') return
      const normalized = normalizeLineItem(cell)
      const monthKey = MONTH_LABEL_TO_KEY[normalized]
      if (monthKey) {
        monthCols[monthKey] = cellIndex
      }
    })

    if (Object.keys(monthCols).length >= BUDGET_IMPORT_MIN_MONTH_HEADERS) {
      return {
        monthCols,
        monthRowIndex: rowIndex,
      }
    }
  }

  return null
}

function getLineItemFromMonthlyRow(row: unknown[]): string {
  const primary = row[2]
  if (typeof primary === 'string' && primary.trim()) return primary.trim()

  const fallback = row[1]
  if (typeof fallback === 'string' && fallback.trim() && !normalizeLineItem(fallback).startsWith('total')) {
    return fallback.trim()
  }

  const topLevel = row[0]
  if (typeof topLevel === 'string' && topLevel.trim() && !normalizeLineItem(topLevel).startsWith('total')) {
    return topLevel.trim()
  }

  return ''
}

function hasGroupedMonthlyBudgetSections(rows: unknown[][]): boolean {
  const detectedMonths = detectMonthColumns(rows)
  if (!detectedMonths) return false

  const monthColumnIndexes = Object.values(detectedMonths.monthCols)

  for (let rowIndex = detectedMonths.monthRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!Array.isArray(row)) continue

    const rawLineItem = getLineItemFromMonthlyRow(row)
    if (!rawLineItem) continue

    const normalizedLine = normalizeLineItem(rawLineItem)
    if (!normalizedLine || normalizedLine.includes('total')) continue

    const hasMonthValues = monthColumnIndexes.some((columnIndex) => parseNumericCell(row[columnIndex]) !== null)
    if (!hasMonthValues) {
      return true
    }
  }

  return false
}

function getLineItemFromFallbackAnnualRow(row: unknown[]): string {
  const primary = row[FALLBACK_LINE_COLUMN_INDEX]
  if (typeof primary === 'string' && primary.trim()) return primary.trim()

  const fallback = row[FALLBACK_LINE_COLUMN_INDEX - 1]
  if (typeof fallback === 'string' && fallback.trim() && !normalizeLineItem(fallback).startsWith('total')) {
    return fallback.trim()
  }

  return ''
}

function isCompatibleFallbackAnnualRow(row: unknown[]): boolean {
  if (isPopulatedCell(row[0])) return false
  return !row.slice(FALLBACK_VALUE_COLUMN_INDEX + 1).some((cell) => isPopulatedCell(cell))
}

export type ParsedBudgetImportLayout = 'monthly-columns' | 'header-annual' | 'fallback-annual'

export type ParsedBudgetSheet = {
  lines: BudgetLineAmounts
  periods: Partial<Record<BudgetPeriodKey, BudgetLineAmounts>>
  importedPeriods: BudgetPeriodKey[]
  availablePeriods: BudgetPeriodKey[]
  rowsProcessed: number
  keysImported: number
  recognizedKeys: string[]
  unmappedLineItems: string[]
  usedHeaderLayout: boolean
  layout: ParsedBudgetImportLayout
  isValid: boolean
  validationError: string | null
}

export function parseBudgetSheetRows(rows: unknown[][]): ParsedBudgetSheet {
  return parseBudgetSheetRowsForPeriod(rows, 'annual')
}

export function parseBudgetSheetRowsForPeriod(rows: unknown[][], period: BudgetPeriodKey): ParsedBudgetSheet {
  const detectedMonths = detectMonthColumns(rows)
  if (detectedMonths) {
    const importedPeriods: BudgetMonthKey[] = period === 'annual'
      ? sortBudgetMonthKeys(Object.keys(detectedMonths.monthCols) as BudgetMonthKey[])
      : [period as BudgetMonthKey]

    if (period !== 'annual' && !detectedMonths.monthCols[period]) {
      return {
        lines: {},
        periods: {},
        importedPeriods: [],
        availablePeriods: sortBudgetMonthKeys(Object.keys(detectedMonths.monthCols) as BudgetMonthKey[]),
        rowsProcessed: 0,
        keysImported: 0,
        recognizedKeys: [],
        unmappedLineItems: [],
        usedHeaderLayout: false,
        layout: 'monthly-columns',
        isValid: false,
        validationError: `Workbook does not contain a ${period} month column.`,
      }
    }

    const periodLines: Partial<Record<BudgetPeriodKey, BudgetLineAmounts>> = Object.fromEntries(
      importedPeriods.map((periodKey) => [periodKey, {}]),
    ) as Partial<Record<BudgetPeriodKey, BudgetLineAmounts>>
    const unmappedLineItems = new Set<string>()
    const recognizedKeys = new Set<string>()
    let rowsProcessed = 0
    let keysImported = 0

    for (let rowIndex = detectedMonths.monthRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      if (!Array.isArray(row)) continue

      const rawLineItem = getLineItemFromMonthlyRow(row)
      if (!rawLineItem) continue

      const normalizedLine = normalizeLineItem(rawLineItem)
      if (!normalizedLine || normalizedLine.includes('total')) continue
      const key = parseBudgetLineKey(rawLineItem)
      if (!key) continue

      let importedValueCount = 0
      for (const periodKey of importedPeriods) {
        const columnIndex = detectedMonths.monthCols[periodKey]
        if (columnIndex === undefined) continue
        const numericValue = parseNumericCell(row[columnIndex])
        if (numericValue === null) continue
        const target = periodLines[periodKey] ?? {}
        target[key] = (target[key] ?? 0) + numericValue
        periodLines[periodKey] = target
        importedValueCount += 1
        rowsProcessed += 1
        keysImported += 1
      }

      if (importedValueCount === 0) continue

      if (BUDGET_LINE_ENTRY_BY_KEY[key]) {
        recognizedKeys.add(key)
      } else {
        unmappedLineItems.add(rawLineItem.trim())
      }
    }

    const lines = summarizeImportedPeriods(periodLines, importedPeriods)
    const validationError =
      keysImported === 0
        ? 'No importable budget rows were found in the selected workbook.'
        : null

    return {
      lines,
      periods: periodLines,
      importedPeriods,
      availablePeriods: sortBudgetMonthKeys(Object.keys(detectedMonths.monthCols) as BudgetMonthKey[]),
      rowsProcessed,
      keysImported,
      recognizedKeys: Array.from(recognizedKeys).sort(),
      unmappedLineItems: Array.from(unmappedLineItems).sort(),
      usedHeaderLayout: false,
      layout: 'monthly-columns',
      isValid: validationError === null,
      validationError,
    }
  }

  if (period !== 'annual') {
    return {
      lines: {},
      periods: {},
      importedPeriods: [],
      availablePeriods: ['annual'],
      rowsProcessed: 0,
      keysImported: 0,
      recognizedKeys: [],
      unmappedLineItems: [],
      usedHeaderLayout: false,
      layout: 'header-annual',
      isValid: false,
      validationError: `Workbook does not contain a ${period} month column.`,
    }
  }

  const { startRow, lineColumn, valueColumn, detectedFromHeaders } = detectSheetLayout(rows)
  const lines: BudgetLineAmounts = {}
  const unmappedLineItems = new Set<string>()
  const recognizedKeys = new Set<string>()
  let rowsProcessed = 0
  let keysImported = 0

  for (let rowIndex = startRow; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!Array.isArray(row)) continue

    if (!detectedFromHeaders && !isCompatibleFallbackAnnualRow(row)) continue

    const rawLineItem = detectedFromHeaders
      ? row[lineColumn]
      : getLineItemFromFallbackAnnualRow(row)
    const rawBudgetValue = row[valueColumn]
    if (typeof rawLineItem !== 'string' || !rawLineItem.trim()) continue

    const normalizedLine = normalizeLineItem(rawLineItem)
    if (!normalizedLine || normalizedLine.includes('total')) continue

    const numericValue = parseNumericCell(rawBudgetValue)
    if (numericValue === null) continue

    const key = parseBudgetLineKey(rawLineItem)
    if (!key) continue

    lines[key] = numericValue
    rowsProcessed += 1
    keysImported += 1

    if (BUDGET_LINE_ENTRY_BY_KEY[key]) {
      recognizedKeys.add(key)
    } else {
      unmappedLineItems.add(rawLineItem.trim())
    }
  }

  let validationError: string | null = null
  if (keysImported === 0) {
    validationError = detectedFromHeaders
      ? 'No importable budget rows were found in the selected workbook.'
      : 'Workbook does not match the expected budget template layout.'
  } else if (!detectedFromHeaders) {
    if (recognizedKeys.size < MIN_RECOGNIZED_KEYS_WITHOUT_HEADERS) {
      validationError = 'Workbook does not contain enough recognized budget lines to validate the template.'
    } else if (rowsProcessed < MIN_PARSED_ROWS_WITHOUT_HEADERS) {
      validationError = 'Workbook does not contain enough parsed budget rows to validate the template.'
    }
  }

  return {
    lines,
    periods: { annual: lines },
    importedPeriods: ['annual'],
    availablePeriods: ['annual'],
    rowsProcessed,
    keysImported,
    recognizedKeys: Array.from(recognizedKeys).sort(),
    unmappedLineItems: Array.from(unmappedLineItems).sort(),
    usedHeaderLayout: detectedFromHeaders,
    layout: detectedFromHeaders ? 'header-annual' : 'fallback-annual',
    isValid: validationError === null,
    validationError,
  }
}

function normalizeSheetName(sheetName: string): string {
  return sheetName.trim().toLowerCase()
}

function getDepartmentForSheetName(sheetName: string): BudgetDepartment | null {
  const normalized = normalizeSheetName(sheetName)
  if (SHEET_TO_DEPARTMENT[normalized]) {
    return SHEET_TO_DEPARTMENT[normalized]
  }
  return BUDGET_DEPTS.find((department) => normalizeSheetName(department) === normalized) ?? null
}

export function resolveSheetsToImport(
  workbook: XLSX.WorkBook,
  department: BudgetDepartment | 'All',
): Array<{ sheetName: string; department: BudgetDepartment }> {
  if (department !== 'All') {
    const validSheetNames = new Set([
      normalizeSheetName(department),
      ...Object.entries(SHEET_TO_DEPARTMENT)
        .filter(([, mappedDepartment]) => mappedDepartment === department)
        .map(([sheetName]) => sheetName),
    ])
    const exact = workbook.SheetNames.find((sheetName) => validSheetNames.has(normalizeSheetName(sheetName)))
    if (exact) return [{ sheetName: exact, department }]

    const normalizedFallbackSheetNames = new Set(
      BUDGET_IMPORT_FALLBACK_SHEET_NAMES.map((candidate) => normalizeSheetName(candidate)),
    )
    const fallback = workbook.SheetNames.find((sheetName) => (
      normalizedFallbackSheetNames.has(normalizeSheetName(sheetName))
    ))
    if (fallback) {
      return [{ sheetName: fallback, department }]
    }

    if (workbook.SheetNames.length === 1) {
      return [{ sheetName: workbook.SheetNames[0], department }]
    }

    return []
  }

  return workbook.SheetNames
    .map((sheetName) => {
      const mappedDepartment = getDepartmentForSheetName(sheetName)
      return mappedDepartment ? { sheetName, department: mappedDepartment } : null
    })
    .filter((entry): entry is { sheetName: string; department: BudgetDepartment } => entry !== null)
}

export type ParsedBudgetWorkbookDepartment = {
  department: BudgetDepartment
  lines: BudgetLineAmounts
  periods: Partial<Record<BudgetPeriodKey, BudgetLineAmounts>>
  importedPeriods: BudgetPeriodKey[]
  availablePeriods: BudgetPeriodKey[]
  rowsProcessed: number
  keysImported: number
  recognizedKeys: string[]
  unmappedLineItems: string[]
  usedHeaderLayout: boolean
  layout: ParsedBudgetImportLayout
}

export type ParsedBudgetWorkbook = {
  departments: ParsedBudgetWorkbookDepartment[]
  departmentsMissing: BudgetDepartment[]
  invalidSheets: Array<{
    sheetName: string
    department: BudgetDepartment
    error: string
  }>
}

function mergeParsedDepartmentSheets(
  department: BudgetDepartment,
  parsedSheets: readonly ParsedBudgetSheet[],
): ParsedBudgetWorkbookDepartment | null {
  if (parsedSheets.length === 0) return null

  const usesMonthlyColumns = parsedSheets.some((sheet) => sheet.layout === 'monthly-columns')
  if (usesMonthlyColumns && parsedSheets.some((sheet) => sheet.layout !== 'monthly-columns')) {
    return null
  }

  const periods: Partial<Record<BudgetPeriodKey, BudgetLineAmounts>> = {}
  const importedPeriods = new Set<BudgetPeriodKey>()
  const availablePeriods = new Set<BudgetPeriodKey>()
  const recognizedKeys = new Set<string>()
  const unmappedLineItems = new Set<string>()
  let rowsProcessed = 0
  let keysImported = 0
  let usedHeaderLayout = false

  for (const parsedSheet of parsedSheets) {
    for (const importedPeriod of parsedSheet.importedPeriods) {
      importedPeriods.add(importedPeriod)
    }
    for (const availablePeriod of parsedSheet.availablePeriods) {
      availablePeriods.add(availablePeriod)
    }
    for (const recognizedKey of parsedSheet.recognizedKeys) {
      recognizedKeys.add(recognizedKey)
    }
    for (const unmappedLineItem of parsedSheet.unmappedLineItems) {
      unmappedLineItems.add(unmappedLineItem)
    }

    for (const [periodKey, periodLines] of Object.entries(parsedSheet.periods) as Array<[BudgetPeriodKey, BudgetLineAmounts]>) {
      periods[periodKey] = mergeBudgetLineAmounts(periods[periodKey] ?? {}, periodLines)
    }

    rowsProcessed += parsedSheet.rowsProcessed
    keysImported += parsedSheet.keysImported
    usedHeaderLayout ||= parsedSheet.usedHeaderLayout
  }

  return {
    department,
    lines: summarizeImportedPeriods(periods, sortBudgetPeriodKeys(Array.from(importedPeriods))),
    periods,
    importedPeriods: sortBudgetPeriodKeys(Array.from(importedPeriods)),
    availablePeriods: sortBudgetPeriodKeys(Array.from(availablePeriods)),
    rowsProcessed,
    keysImported,
    recognizedKeys: Array.from(recognizedKeys).sort(),
    unmappedLineItems: Array.from(unmappedLineItems).sort(),
    usedHeaderLayout,
    layout: usesMonthlyColumns
      ? 'monthly-columns'
      : parsedSheets.some((sheet) => sheet.layout === 'header-annual')
        ? 'header-annual'
        : 'fallback-annual',
  }
}

function parseSingleDepartmentWorkbookByCategoryTabs(
  workbook: XLSX.WorkBook,
  department: BudgetDepartment,
  period: BudgetPeriodKey,
): {
  departmentEntry: ParsedBudgetWorkbookDepartment | null
  invalidSheets: ParsedBudgetWorkbook['invalidSheets']
} {
  const candidateSheetNames = workbook.SheetNames.filter((sheetName) => (
    !BUDGET_IMPORT_IGNORED_SHEET_NAMES.some((ignoredName: string) => normalizeSheetName(ignoredName) === normalizeSheetName(sheetName))
  ))

  const validSheets: ParsedBudgetSheet[] = []
  const invalidSheets: ParsedBudgetWorkbook['invalidSheets'] = []

  for (const sheetName of candidateSheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
    const parsedSheet = parseBudgetSheetRowsForPeriod(rows, period)
    const hasGroupedSections = parsedSheet.layout === 'monthly-columns'
      ? hasGroupedMonthlyBudgetSections(rows)
      : true

    if (parsedSheet.isValid && parsedSheet.recognizedKeys.length > 0 && hasGroupedSections) {
      validSheets.push(parsedSheet)
      continue
    }

    invalidSheets.push({
      sheetName,
      department,
      error: parsedSheet.validationError || 'Invalid budget template',
    })
  }

  return {
    departmentEntry: mergeParsedDepartmentSheets(department, validSheets),
    invalidSheets: validSheets.length > 0 ? [] : invalidSheets,
  }
}

export function parseBudgetWorkbook(
  buffer: ArrayBuffer,
  department: BudgetDepartment | 'All',
  period: BudgetPeriodKey = 'annual',
): ParsedBudgetWorkbook {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetsToImport = resolveSheetsToImport(workbook, department)
  const parsedDepartments: ParsedBudgetWorkbookDepartment[] = []
  const invalidSheets: ParsedBudgetWorkbook['invalidSheets'] = []

  if (department !== 'All' && sheetsToImport.length === 0) {
    const categoryFallback = parseSingleDepartmentWorkbookByCategoryTabs(workbook, department, period)
    return {
      departments: categoryFallback.departmentEntry ? [categoryFallback.departmentEntry] : [],
      departmentsMissing: categoryFallback.departmentEntry ? [] : [department],
      invalidSheets: categoryFallback.invalidSheets,
    }
  }

  for (const { sheetName, department: mappedDepartment } of sheetsToImport) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
    const parsedSheet = parseBudgetSheetRowsForPeriod(rows, period)

    if (!parsedSheet.isValid) {
      invalidSheets.push({
        sheetName,
        department: mappedDepartment,
        error: parsedSheet.validationError || 'Invalid budget template',
      })
      continue
    }

    parsedDepartments.push({
      department: mappedDepartment,
      lines: parsedSheet.lines,
      periods: parsedSheet.periods,
      importedPeriods: parsedSheet.importedPeriods,
      availablePeriods: parsedSheet.availablePeriods,
      rowsProcessed: parsedSheet.rowsProcessed,
      keysImported: parsedSheet.keysImported,
      recognizedKeys: parsedSheet.recognizedKeys,
      unmappedLineItems: parsedSheet.unmappedLineItems,
      usedHeaderLayout: parsedSheet.usedHeaderLayout,
      layout: parsedSheet.layout,
    })
  }

  const departmentsMissing =
    department === 'All'
      ? BUDGET_DEPTS.filter((dept) => !parsedDepartments.some((entry) => entry.department === dept))
      : parsedDepartments.length
        ? []
        : [department]

  return {
    departments: parsedDepartments,
    departmentsMissing,
    invalidSheets,
  }
}

// True only when every parsed department sheet used the monthly-columns
// layout — i.e. the workbook is clearly scoped to specific months. The
// merge-import path uses this to refuse a line-item/annual workbook, which
// would otherwise impact ALL months and silently wipe the ones absent from
// the file. Q4 (Oct/Nov/Dec = 3 month headers) satisfies this.
export function isMonthScopedWorkbook(workbook: ParsedBudgetWorkbook): boolean {
  return (
    workbook.departments.length > 0 &&
    workbook.departments.every((dept) => dept.layout === 'monthly-columns')
  )
}

export function mergeDepartmentPeriod(
  existingPlan: BudgetDepartmentPlan | null,
  input: {
    year: number
    department: BudgetDepartment
    period: BudgetPeriodKey
    lines: BudgetLineAmounts
    importMeta: BudgetImportMeta
  },
): BudgetDepartmentPlan {
  return {
    version: 1,
    year: input.year,
    department: input.department,
    periods: {
      ...(existingPlan?.periods ?? {}),
      [input.period]: normalizeBudgetLineAmounts(input.lines),
    },
    source: 'sheet-import',
    importMeta: input.importMeta,
  }
}

export function mergeDepartmentPeriods(
  existingPlan: BudgetDepartmentPlan | null,
  input: {
    year: number
    department: BudgetDepartment
    periods: Partial<Record<BudgetPeriodKey, BudgetLineAmounts>>
    importMeta: BudgetImportMeta
  },
): BudgetDepartmentPlan | null {
  let nextPlan = existingPlan

  for (const [period, lines] of Object.entries(input.periods) as Array<[BudgetPeriodKey, BudgetLineAmounts]>) {
    nextPlan = mergeDepartmentPeriod(nextPlan, {
      year: input.year,
      department: input.department,
      period,
      lines,
      importMeta: input.importMeta,
    })
  }

  return nextPlan
}

function planPeriodHasBudgetData(
  plan: BudgetDepartmentPlan | null,
  period: BudgetPeriodKey,
): boolean {
  const normalized = normalizeBudgetLineAmounts(plan?.periods?.[period] ?? {})
  return Object.keys(normalized).length > 0
}

function getBudgetImportImpactedPeriods(
  input: Pick<ParsedBudgetWorkbookDepartment, 'layout' | 'importedPeriods'>,
): BudgetPeriodKey[] {
  const impacted = new Set<BudgetPeriodKey>(input.importedPeriods)

  if (input.layout === 'monthly-columns') {
    impacted.add('annual')
  } else {
    for (const monthKey of ALL_BUDGET_MONTH_KEYS) {
      impacted.add(monthKey)
    }
  }

  return sortBudgetPeriodKeys(Array.from(impacted))
}

export function getBudgetImportExistingPeriodsToReplace(
  existingPlan: BudgetDepartmentPlan | null,
  input: Pick<ParsedBudgetWorkbookDepartment, 'layout' | 'importedPeriods'>,
): BudgetPeriodKey[] {
  return getBudgetImportImpactedPeriods(input).filter((period) => planPeriodHasBudgetData(existingPlan, period))
}

export function prepareDepartmentPlanForImport(
  existingPlan: BudgetDepartmentPlan | null,
  input: Pick<ParsedBudgetWorkbookDepartment, 'layout' | 'importedPeriods'>,
): BudgetDepartmentPlan | null {
  return clearDepartmentPeriods(existingPlan, getBudgetImportImpactedPeriods(input))
}

export function clearDepartmentPeriod(
  existingPlan: BudgetDepartmentPlan | null,
  period: BudgetPeriodKey,
): BudgetDepartmentPlan | null {
  if (!existingPlan?.periods?.[period]) return existingPlan

  const nextPeriods = Object.fromEntries(
    Object.entries(existingPlan.periods).filter(([key]) => key !== period),
  ) as Partial<Record<BudgetPeriodKey, BudgetLineAmounts>>

  if (Object.keys(nextPeriods).length === 0) {
    return null
  }

  return {
    ...existingPlan,
    periods: nextPeriods,
  }
}

export function clearDepartmentPeriods(
  existingPlan: BudgetDepartmentPlan | null,
  periods: BudgetPeriodKey[],
): BudgetDepartmentPlan | null {
  let nextPlan = existingPlan

  for (const period of periods) {
    nextPlan = clearDepartmentPeriod(nextPlan, period)
    if (!nextPlan) return null
  }

  return nextPlan
}

export function diffBudgetLineAmounts(
  before: BudgetLineAmounts,
  after: BudgetLineAmounts,
): BudgetLineDiffEntry[] {
  const normalizedBefore = normalizeBudgetLineAmounts(before)
  const normalizedAfter = normalizeBudgetLineAmounts(after)
  const keys = Array.from(new Set([...Object.keys(normalizedBefore), ...Object.keys(normalizedAfter)])).sort()

  return keys
    .map<BudgetLineDiffEntry | null>((key) => {
      const beforeUsd = normalizedBefore[key] ?? 0
      const afterUsd = normalizedAfter[key] ?? 0
      if (beforeUsd === afterUsd) return null

      let status: BudgetLineDiffEntry['status'] = 'changed'
      if (beforeUsd === 0 && afterUsd !== 0) status = 'added'
      if (beforeUsd !== 0 && afterUsd === 0) status = 'removed'

      return {
        key,
        label: formatBudgetLineLabel(key),
        category: BUDGET_LINE_ENTRY_BY_KEY[key]?.category ?? 'Custom',
        beforeUsd,
        afterUsd,
        deltaUsd: afterUsd - beforeUsd,
        status,
      }
    })
    .filter((entry): entry is BudgetLineDiffEntry => entry !== null)
    .sort((left, right) => Math.abs(right.deltaUsd) - Math.abs(left.deltaUsd))
}

export function toBudgetPeriodKey(period: string): BudgetPeriodKey | null {
  if (period === 'annual') return 'annual'
  if (/^(0[1-9]|1[0-2])$/.test(period)) return period as BudgetMonthKey
  return null
}

export function formatBudgetPeriodLabel(period: BudgetPeriodKey): string {
  return period === 'annual' ? 'annual' : `month ${period}`
}

export { describeBudgetImportWorkbookRequirements }
