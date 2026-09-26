import { normalizeBudgetLineAmounts } from './catalog.ts'
import {
  applyBudgetDepartmentActuals as applyBudgetDepartmentActualsState,
  applyBudgetOverviewActuals as applyBudgetOverviewActualsState,
} from './actuals.ts'
import { coveredMonths, type AdjustmentRecord } from './adjustments.ts'
import {
  getBudgetScopeEndMonth,
  getBudgetScopeMonthIndices,
  getBudgetScopePeriodLabel,
  getBudgetScopeYtdLabel,
  getBudgetScopeYtdMonthIndices,
  monthIndexToPeriodKey,
} from './scope.ts'
import type {
  BudgetDepartment,
  BudgetDepartmentActualScope,
  BudgetDepartmentActualsState,
  BudgetLineAmounts,
  BudgetOverviewActualsState,
  BudgetPlanBreakdownState,
  BudgetPlanState,
  BudgetReportCell,
  BudgetReportColumnKey,
  BudgetReportRow,
  BudgetReportTableModel,
  BudgetViewState,
} from './types.ts'

type BudgetReportLineSpec = {
  category: string
  label: string
  key: string
}

type BudgetReportSectionSpec = {
  category: string
  lines: BudgetReportLineSpec[]
  subtotalLabel?: string
}

const REVENUE_KEY = 'coreProductRevenue'
const CONTINGENCY_KEY = 'contingency'

const PRIMARY_EXPENSE_SECTIONS: BudgetReportSectionSpec[] = [
  {
    category: 'Compensation & Benefits',
    lines: [
      { category: 'Compensation & Benefits', label: 'Salaries & Wages', key: 'salary' },
      { category: 'Compensation & Benefits', label: 'Benefits', key: 'benefits' },
      { category: 'Compensation & Benefits', label: 'Payroll Taxes', key: 'payroll' },
      { category: 'Compensation & Benefits', label: 'Severance Pay', key: 'severance' },
    ],
    subtotalLabel: 'Total Compensation & Benefits',
  },
  {
    category: 'Software & SaaS',
    lines: [
      { category: 'Software & SaaS', label: 'Department Tools', key: 'epdTools' },
      { category: 'Software & SaaS', label: 'Company Tools', key: 'bizTools' },
    ],
    subtotalLabel: 'Total Software & SaaS',
  },
  {
    category: 'Hosting & Infrastructure',
    lines: [
      { category: 'Hosting & Infrastructure', label: 'Cloud Hosting & Compute', key: 'hosting' },
      { category: 'Hosting & Infrastructure', label: 'Blockchain & RPC', key: 'blockchainRpc' },
      { category: 'Hosting & Infrastructure', label: 'Security & Monitoring', key: 'securityMon' },
    ],
    subtotalLabel: 'Total Hosting & Infrastructure',
  },
  {
    category: 'HR & Recruiting',
    lines: [
      { category: 'HR & Recruiting', label: 'HR Costs', key: 'hrCosts' },
      { category: 'HR & Recruiting', label: 'Third-Party & Referrals', key: 'recruiting' },
    ],
    subtotalLabel: 'Total HR & Recruiting',
  },
  {
    category: 'Marketing Expense',
    lines: [
      { category: 'Marketing Expense', label: 'Events', key: 'meals' },
      { category: 'Marketing Expense', label: 'Other', key: 'mktExp' },
    ],
    subtotalLabel: 'Total Marketing Expense',
  },
  {
    category: 'Professional Services',
    lines: [
      { category: 'Professional Services', label: 'Professional Services', key: 'profSvc' },
      { category: 'Professional Services', label: 'Corporate Compliance', key: 'corpCompliance' },
      { category: 'Professional Services', label: 'Industry Relations', key: 'industryRelations' },
    ],
    subtotalLabel: 'Total Professional Services',
  },
]

const DIRECT_EXPENSE_SECTIONS: BudgetReportSectionSpec[] = [
  {
    category: 'Travel & Entertainment',
    lines: [
      { category: 'Travel & Entertainment', label: 'Travel & Entertainment', key: 'travel' },
    ],
  },
  {
    category: 'Company Offsite',
    lines: [
      { category: 'Company Offsite', label: 'Company Offsite', key: 'colos' },
    ],
  },
  {
    category: 'Transaction Fees',
    lines: [
      { category: 'Transaction Fees', label: 'Transaction Fees', key: 'bankFees' },
    ],
  },
  {
    category: 'Office',
    lines: [
      { category: 'Office', label: 'Office', key: 'rent' },
    ],
  },
  {
    category: 'Misc Expenses',
    lines: [
      { category: 'Misc Expenses', label: 'Misc Expenses', key: 'hardware' },
    ],
  },
]

const INCENTIVE_COMP_SECTION: BudgetReportSectionSpec = {
  category: 'Incentive Compensation',
  lines: [
    { category: 'Incentive Compensation', label: 'Bonus', key: 'bonus' },
    { category: 'Incentive Compensation', label: 'Commissions', key: 'commissions' },
  ],
  subtotalLabel: 'Total IC',
}

// Flat list of the expense line items (category + label + key), in report
// order. Exported so the import-template generator produces a workbook whose
// labels round-trip back through parseBudgetLineKey. Revenue is excluded (it's
// not a budget line the operator fills in the template).
export const BUDGET_TEMPLATE_LINE_SPECS: BudgetReportLineSpec[] = [
  ...PRIMARY_EXPENSE_SECTIONS.flatMap((section) => section.lines),
  ...DIRECT_EXPENSE_SECTIONS.flatMap((section) => section.lines),
  ...INCENTIVE_COMP_SECTION.lines,
  { category: 'Contingency', label: 'Contingency', key: CONTINGENCY_KEY },
]

const PRIMARY_EXPENSE_KEYS = PRIMARY_EXPENSE_SECTIONS.flatMap((section) => section.lines.map((line) => line.key))
const DIRECT_EXPENSE_KEYS = DIRECT_EXPENSE_SECTIONS.flatMap((section) => section.lines.map((line) => line.key))
const INCENTIVE_COMP_KEYS = INCENTIVE_COMP_SECTION.lines.map((line) => line.key)
const EXPENSE_EX_IC_KEYS = [...PRIMARY_EXPENSE_KEYS, ...DIRECT_EXPENSE_KEYS]
const TOTAL_EXPENSE_ACTUAL_KEYS = [...EXPENSE_EX_IC_KEYS, ...INCENTIVE_COMP_KEYS]

function emptyLines(): BudgetLineAmounts {
  return {}
}

function hasLineAmounts(lines: BudgetLineAmounts | null | undefined): boolean {
  return !!lines && Object.keys(lines).length > 0
}

function cloneLines(lines: BudgetLineAmounts): BudgetLineAmounts {
  return Object.fromEntries(Object.entries(lines)) as BudgetLineAmounts
}

function addLineAmounts(target: BudgetLineAmounts, source: BudgetLineAmounts) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (value ?? 0)
  }
}

function sumLineAmounts(lines: BudgetLineAmounts): number {
  return Object.values(lines).reduce((sum, value) => sum + (value ?? 0), 0)
}

function sumSelectedLineAmounts(lines: BudgetLineAmounts, keys: readonly string[]): number {
  return keys.reduce((sum, key) => sum + (lines[key] ?? 0), 0)
}

function toBudgetDisplayValue(value: number): number | null {
  return value === 0 ? null : value
}

function buildPlaceholderCell(budgetUsd: number | null): BudgetReportCell {
  return {
    budgetUsd,
    actualUsd: null,
    varianceUsd: null,
  }
}

function createCategoryRow(category: string, tone: BudgetReportRow['tone'] = 'default'): BudgetReportRow {
  const cells = {
    period: buildPlaceholderCell(null),
    ytd: buildPlaceholderCell(null),
    annual: buildPlaceholderCell(null),
  }

  return {
    kind: 'category',
    key: `category:${category}`,
    label: category,
    category,
    tone,
    cells,
  }
}

function createLineRow(
  line: BudgetReportLineSpec,
  periodBudget: number,
  ytdBudget: number,
  annualBudget: number,
  budgetKeys: string[] | null = [line.key],
  actualKeys: string[] | null = [line.key],
  tone: BudgetReportRow['tone'] = 'default',
): BudgetReportRow {
  return {
    kind: 'line',
    key: line.key,
    label: line.label,
    category: line.category,
    budgetKeys,
    actualKeys,
    tone,
    cells: {
      period: buildPlaceholderCell(toBudgetDisplayValue(periodBudget)),
      ytd: buildPlaceholderCell(toBudgetDisplayValue(ytdBudget)),
      annual: buildPlaceholderCell(toBudgetDisplayValue(annualBudget)),
    },
  }
}

function createTotalRow(
  key: string,
  label: string,
  category: string,
  budgetKeys: string[] | null,
  actualKeys: string[] | null,
  periodBudget: number,
  ytdBudget: number,
  annualBudget: number,
  tone: BudgetReportRow['tone'] = 'subtotal',
): BudgetReportRow {
  return {
    kind: 'total',
    key,
    label,
    category,
    budgetKeys,
    actualKeys,
    tone,
    cells: {
      period: buildPlaceholderCell(toBudgetDisplayValue(periodBudget)),
      ytd: buildPlaceholderCell(toBudgetDisplayValue(ytdBudget)),
      annual: buildPlaceholderCell(toBudgetDisplayValue(annualBudget)),
    },
  }
}

function getDepartmentAnnualLines(plan: BudgetPlanState, department: BudgetDepartmentActualScope): BudgetLineAmounts {
  if (department === 'Not specified') return emptyLines()

  const departmentPlan = plan.departments[department]
  const importedOnly = plan.source === 'sheet-import'
  if (importedOnly && departmentPlan?.source !== 'sheet-import') {
    return emptyLines()
  }

  const annual = departmentPlan?.periods?.annual
  if (annual) {
    const normalizedAnnual = normalizeBudgetLineAmounts(annual)
    if (hasLineAmounts(normalizedAnnual)) {
      return cloneLines(normalizedAnnual)
    }
  }

  const totals = emptyLines()
  const periods = departmentPlan?.periods ?? {}
  for (const [period, lines] of Object.entries(periods)) {
    if (period === 'annual' || !lines) continue
    const normalizedLines = normalizeBudgetLineAmounts(lines)
    if (!hasLineAmounts(normalizedLines)) continue
    addLineAmounts(totals, normalizedLines)
  }
  return totals
}

function getDepartmentLinesForMonths(
  plan: BudgetPlanState,
  department: BudgetDepartmentActualScope,
  months: number[],
): BudgetLineAmounts {
  const annualLines = getDepartmentAnnualLines(plan, department)
  if (department === 'Not specified') return annualLines
  const departmentPlan = plan.departments[department]
  const importedOnly = plan.source === 'sheet-import'
  if (importedOnly && departmentPlan?.source !== 'sheet-import') {
    return emptyLines()
  }

  const periods = departmentPlan?.periods ?? {}
  const totals = emptyLines()
  const canScaleAnnual =
    (departmentPlan?.source === 'sheet-import' || (!importedOnly && departmentPlan?.source === 'placeholder-static'))
    && hasLineAmounts(annualLines)

  for (const month of months) {
    const periodKey = monthIndexToPeriodKey(month)
    const periodLines = periods[periodKey] ? normalizeBudgetLineAmounts(periods[periodKey]!) : undefined
    if (periodLines && hasLineAmounts(periodLines)) {
      addLineAmounts(totals, periodLines)
      continue
    }

    if (canScaleAnnual) {
      for (const [key, annualValue] of Object.entries(annualLines)) {
        totals[key] = (totals[key] ?? 0) + (annualValue ?? 0) / 12
      }
    }
  }

  return totals
}

function getPlanLinesForMonths(
  plan: BudgetPlanState,
  departments: readonly BudgetDepartment[],
  months: number[],
): BudgetLineAmounts {
  const totals = emptyLines()
  for (const department of departments) {
    addLineAmounts(totals, getDepartmentLinesForMonths(plan, department, months))
  }
  return totals
}

function getPlanAnnualLines(
  plan: BudgetPlanState,
  departments: readonly BudgetDepartment[],
): BudgetLineAmounts {
  const totals = emptyLines()
  for (const department of departments) {
    addLineAmounts(totals, getDepartmentAnnualLines(plan, department))
  }
  return totals
}

function buildV1ParityRows(
  periodLines: BudgetLineAmounts,
  ytdLines: BudgetLineAmounts,
  annualLines: BudgetLineAmounts,
): BudgetReportRow[] {
  const rows: BudgetReportRow[] = []

  rows.push(createCategoryRow('Revenue', 'revenue'))
  rows.push({
    kind: 'line',
    key: REVENUE_KEY,
    label: 'Core Product Revenue',
    category: 'Revenue',
    budgetKeys: [REVENUE_KEY],
    actualKeys: [REVENUE_KEY],
    tone: 'revenue',
    cells: {
      period: buildPlaceholderCell(null),
      ytd: buildPlaceholderCell(null),
      annual: buildPlaceholderCell(null),
    },
  })

  for (const section of PRIMARY_EXPENSE_SECTIONS) {
    rows.push(createCategoryRow(section.category))
    for (const line of section.lines) {
      rows.push(createLineRow(
        line,
        periodLines[line.key] ?? 0,
        ytdLines[line.key] ?? 0,
        annualLines[line.key] ?? 0,
        [line.key],
      ))
    }

    if (section.subtotalLabel) {
      const sectionKeys = section.lines.map((line) => line.key)
      rows.push(createTotalRow(
        `total:${section.category}`,
        section.subtotalLabel,
        section.category,
        sectionKeys,
        sectionKeys,
        sumSelectedLineAmounts(periodLines, sectionKeys),
        sumSelectedLineAmounts(ytdLines, sectionKeys),
        sumSelectedLineAmounts(annualLines, sectionKeys),
      ))
    }
  }

  for (const section of DIRECT_EXPENSE_SECTIONS) {
    rows.push(createCategoryRow(section.category))
    for (const line of section.lines) {
      rows.push(createLineRow(
        line,
        periodLines[line.key] ?? 0,
        ytdLines[line.key] ?? 0,
        annualLines[line.key] ?? 0,
        [line.key],
      ))
    }
  }

  rows.push(createTotalRow(
    'total:expenses-ex-ic',
    'Total Expenses ex-IC',
    'Expenses',
    EXPENSE_EX_IC_KEYS,
    EXPENSE_EX_IC_KEYS,
    sumSelectedLineAmounts(periodLines, EXPENSE_EX_IC_KEYS),
    sumSelectedLineAmounts(ytdLines, EXPENSE_EX_IC_KEYS),
    sumSelectedLineAmounts(annualLines, EXPENSE_EX_IC_KEYS),
    'grand-total',
  ))

  rows.push(createCategoryRow(INCENTIVE_COMP_SECTION.category))
  for (const line of INCENTIVE_COMP_SECTION.lines) {
    rows.push(createLineRow(
      line,
      periodLines[line.key] ?? 0,
      ytdLines[line.key] ?? 0,
      annualLines[line.key] ?? 0,
      [line.key],
    ))
  }

  rows.push(createTotalRow(
    'total:incentive-compensation',
    INCENTIVE_COMP_SECTION.subtotalLabel ?? 'Total IC',
    INCENTIVE_COMP_SECTION.category,
    INCENTIVE_COMP_KEYS,
    INCENTIVE_COMP_KEYS,
    sumSelectedLineAmounts(periodLines, INCENTIVE_COMP_KEYS),
    sumSelectedLineAmounts(ytdLines, INCENTIVE_COMP_KEYS),
    sumSelectedLineAmounts(annualLines, INCENTIVE_COMP_KEYS),
  ))

  rows.push(createCategoryRow('Contingency'))
  rows.push(createLineRow(
    { category: 'Contingency', label: 'Contingency', key: CONTINGENCY_KEY },
    periodLines[CONTINGENCY_KEY] ?? 0,
    ytdLines[CONTINGENCY_KEY] ?? 0,
    annualLines[CONTINGENCY_KEY] ?? 0,
    [CONTINGENCY_KEY],
    null,
  ))

  rows.push(createTotalRow(
    'total:expenses',
    'Total Expenses',
    'Expenses',
    [...TOTAL_EXPENSE_ACTUAL_KEYS, CONTINGENCY_KEY],
    TOTAL_EXPENSE_ACTUAL_KEYS,
    sumSelectedLineAmounts(periodLines, TOTAL_EXPENSE_ACTUAL_KEYS) + (periodLines[CONTINGENCY_KEY] ?? 0),
    sumSelectedLineAmounts(ytdLines, TOTAL_EXPENSE_ACTUAL_KEYS) + (ytdLines[CONTINGENCY_KEY] ?? 0),
    sumSelectedLineAmounts(annualLines, TOTAL_EXPENSE_ACTUAL_KEYS) + (annualLines[CONTINGENCY_KEY] ?? 0),
    'grand-total',
  ))

  return rows
}

const ALL_MONTH_INDICES = Array.from({ length: 12 }, (_, i) => i + 1)

// Per-line-item signed delta contributed by active adjustments over the given
// month indices. A recurring adjustment counts once per covered month that
// falls inside the scope (so a Q4 recurring shows 3× in a full-year YTD).
function adjustmentDeltaByKey(
  adjustments: AdjustmentRecord[],
  monthIndices: number[],
): Record<string, number> {
  const monthKeys = new Set(monthIndices.map((m) => monthIndexToPeriodKey(m)))
  const out: Record<string, number> = {}
  for (const a of adjustments) {
    const hits = coveredMonths(a).filter((mk) => monthKeys.has(mk)).length
    if (hits > 0) out[a.lineItem] = (out[a.lineItem] ?? 0) + a.amount * hits
  }
  return out
}

function activeAdjustmentsForDepartments(
  adjustments: AdjustmentRecord[],
  departments: readonly string[],
): AdjustmentRecord[] {
  const allowed = new Set(departments)
  return adjustments.filter((a) => a.status === 'active' && allowed.has(a.department))
}

function mergeDelta(target: BudgetLineAmounts, delta: Record<string, number>): void {
  for (const [key, value] of Object.entries(delta)) {
    target[key] = (target[key] ?? 0) + value
  }
}

// Sets adjustmentUsd (annual net) + per-department breakdown on each single-key
// line row. Mutates rows in place.
function annotateRowsWithAdjustments(
  rows: BudgetReportRow[],
  scopedAdjustments: AdjustmentRecord[],
): void {
  const annualByKey = adjustmentDeltaByKey(scopedAdjustments, ALL_MONTH_INDICES)
  const byKeyByDept: Record<string, Record<string, number>> = {}
  for (const a of scopedAdjustments) {
    const annual = a.amount * coveredMonths(a).length
    if (annual === 0) continue
    byKeyByDept[a.lineItem] ??= {}
    byKeyByDept[a.lineItem][a.department] = (byKeyByDept[a.lineItem][a.department] ?? 0) + annual
  }
  for (const row of rows) {
    if (row.kind !== 'line' || !row.budgetKeys || row.budgetKeys.length !== 1) continue
    const key = row.budgetKeys[0]
    const net = annualByKey[key]
    if (!net) continue
    row.adjustmentUsd = net
    row.adjustmentByDepartment = Object.entries(byKeyByDept[key] ?? {}).map(
      ([department, amountUsd]) => ({ department, amountUsd }),
    )
  }
}

export function buildBudgetOverviewReport(
  plan: BudgetPlanState,
  departments: readonly BudgetDepartment[],
  view: BudgetViewState,
  adjustments: AdjustmentRecord[] = [],
): BudgetReportTableModel {
  const periodLines = getPlanLinesForMonths(plan, departments, getBudgetScopeMonthIndices(view))
  const ytdLines = getPlanLinesForMonths(plan, departments, getBudgetScopeYtdMonthIndices(view))
  const annualLines = getPlanAnnualLines(plan, departments)

  const scoped = activeAdjustmentsForDepartments(adjustments, departments)
  mergeDelta(periodLines, adjustmentDeltaByKey(scoped, getBudgetScopeMonthIndices(view)))
  mergeDelta(ytdLines, adjustmentDeltaByKey(scoped, getBudgetScopeYtdMonthIndices(view)))
  mergeDelta(annualLines, adjustmentDeltaByKey(scoped, ALL_MONTH_INDICES))

  const rows = buildV1ParityRows(periodLines, ytdLines, annualLines)
  annotateRowsWithAdjustments(rows, scoped)

  return {
    title: 'Spend by Category — All Departments',
    helperText: 'Click budget value to see dept breakdown',
    entityLabel: view.entity,
    periodLabel: getBudgetScopePeriodLabel(view),
    ytdLabel: getBudgetScopeYtdLabel(view),
    annualLabel: String(view.year),
    actualsStatus: 'placeholder',
    actualDrillOpenMode: 'positive-only',
    rows,
  }
}

export function buildBudgetDepartmentReport(
  plan: BudgetPlanState,
  department: BudgetDepartmentActualScope,
  view: BudgetViewState,
  adjustments: AdjustmentRecord[] = [],
): BudgetReportTableModel {
  const periodLines = getDepartmentLinesForMonths(plan, department, getBudgetScopeMonthIndices(view))
  const ytdLines = getDepartmentLinesForMonths(plan, department, getBudgetScopeYtdMonthIndices(view))
  const annualLines = getDepartmentAnnualLines(plan, department)
  const endMonth = getBudgetScopeEndMonth(view)

  const scoped = activeAdjustmentsForDepartments(adjustments, [String(department)])
  mergeDelta(periodLines, adjustmentDeltaByKey(scoped, getBudgetScopeMonthIndices(view)))
  mergeDelta(ytdLines, adjustmentDeltaByKey(scoped, getBudgetScopeYtdMonthIndices(view)))
  mergeDelta(annualLines, adjustmentDeltaByKey(scoped, ALL_MONTH_INDICES))

  const rows = buildV1ParityRows(periodLines, ytdLines, annualLines)
  annotateRowsWithAdjustments(rows, scoped)

  return {
    title: String(department),
    subtitle: `Department detail · ${getBudgetScopeYtdLabel({ ...view, mode: 'month', month: endMonth })}`,
    entityLabel: view.entity,
    periodLabel: getBudgetScopePeriodLabel(view),
    ytdLabel: getBudgetScopeYtdLabel(view),
    annualLabel: String(view.year),
    actualsStatus: 'placeholder',
    actualDrillOpenMode: 'non-zero',
    rows,
  }
}

export function applyBudgetOverviewActuals(
  report: BudgetReportTableModel,
  actuals: BudgetOverviewActualsState,
): BudgetReportTableModel {
  return applyBudgetOverviewActualsState(report, actuals)
}

export function applyBudgetDepartmentActuals(
  report: BudgetReportTableModel,
  actuals: BudgetDepartmentActualsState,
): BudgetReportTableModel {
  return applyBudgetDepartmentActualsState(report, actuals)
}

export function getBudgetReportTotalBudget(report: BudgetReportTableModel, column: 'period' | 'ytd' | 'annual'): number {
  return report.rows
    .filter((row) => row.kind === 'total')
    .reduce((sum, row) => sum + (row.cells[column].budgetUsd || 0), 0)
}

export function getBudgetLineCount(report: BudgetReportTableModel): number {
  return report.rows.filter((row) => row.kind === 'line').length
}

function getBudgetLinesForColumn(
  plan: BudgetPlanState,
  department: BudgetDepartmentActualScope,
  view: BudgetViewState,
  column: BudgetReportColumnKey,
): BudgetLineAmounts {
  if (column === 'annual') {
    return getDepartmentAnnualLines(plan, department)
  }

  const months = column === 'period'
    ? getBudgetScopeMonthIndices(view)
    : getBudgetScopeYtdMonthIndices(view)

  return getDepartmentLinesForMonths(plan, department, months)
}

export function buildBudgetPlanBreakdown(
  plan: BudgetPlanState,
  departments: readonly BudgetDepartmentActualScope[],
  view: BudgetViewState,
  row: Pick<BudgetReportRow, 'key' | 'label' | 'budgetKeys'>,
  column: BudgetReportColumnKey,
): BudgetPlanBreakdownState {
  const budgetKeys = row.budgetKeys ?? [row.key]
  const entries = departments
    .map((department) => {
      const lines = getBudgetLinesForColumn(plan, department, view, column)
      return {
        department,
        amountUsd: sumSelectedLineAmounts(lines, budgetKeys),
      }
    })
    .filter((entry) => entry.amountUsd > 0)
    .sort((left, right) => right.amountUsd - left.amountUsd)

  const totalUsd = entries.reduce((sum, entry) => sum + entry.amountUsd, 0)

  return {
    year: view.year,
    view,
    column,
    rowKey: row.key,
    rowLabel: row.label,
    totalUsd,
    entries: entries.map((entry) => ({
      ...entry,
      pctOfTotal: totalUsd > 0 ? entry.amountUsd / totalUsd : 0,
    })),
  }
}

export function getBudgetDepartmentPlanCoverage(
  plan: BudgetPlanState,
  departments: readonly BudgetDepartment[],
  months: number[],
): number {
  const periodKeys = months.map(monthIndexToPeriodKey)
  let covered = 0
  let total = 0

  for (const department of departments) {
    total += periodKeys.length
    const periods = plan.departments[department]?.periods ?? {}
    covered += periodKeys.filter((period) => Boolean(periods[period])).length
  }

  return total > 0 ? covered / total : 0
}

export function sumBudgetLines(lines: BudgetLineAmounts): number {
  return sumLineAmounts(lines)
}
