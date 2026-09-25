import type { BUDGET_DEPTS, BUDGET_ENTITIES } from '../constants.ts'
import type { BudgetLineKey } from './catalog.ts'

export type BudgetDepartment = (typeof BUDGET_DEPTS)[number]
export type BudgetDepartmentActualScope = BudgetDepartment | 'Not specified'
export type BudgetDepartmentViewScope = 'All' | BudgetDepartmentActualScope
export type BudgetMonthKey =
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '12'

export type BudgetPeriodKey = 'annual' | BudgetMonthKey
export type BudgetLineCode = BudgetLineKey | string
export type BudgetLineAmounts = Record<BudgetLineCode, number>
export type BudgetEntityScope = 'All' | (typeof BUDGET_ENTITIES)[number]
export type BudgetViewMode = 'ytd' | 'month' | 'range'

export type BudgetPlanSource = 'placeholder-static' | 'sheet-import'
export type BudgetTeamSource = 'placeholder-static' | 'app-managed'
export type BudgetTeamMemberStatus = 'Current' | 'Terminated'

export type BudgetImportMeta = {
  lastImportedAt: string | null
  lastImportedBy: string | null
  sourceFileName: string | null
  templateVersion: string | null
}

export type BudgetDepartmentPlan = {
  version: 1
  year: number
  department: BudgetDepartment
  periods: Partial<Record<BudgetPeriodKey, BudgetLineAmounts>>
  source: BudgetPlanSource
  importMeta: BudgetImportMeta | null
}

export type BudgetPlanState = {
  version: 1
  year: number
  departments: Record<BudgetDepartment, BudgetDepartmentPlan>
  source: BudgetPlanSource
  lastUpdatedAt: string | null
}

export type BudgetTeamMember = {
  id: string
  name: string
  dept: BudgetDepartment
  role: string
  salary: number
  bonus: number
  entity: string
  classification: string
  email: string
  location: string
  ft: string
  status: BudgetTeamMemberStatus
  terminationMonth: BudgetMonthKey | null
}

export type BudgetTeamMemberInput = Omit<BudgetTeamMember, 'id'>

export type BudgetTeamState = {
  version: 1
  year: number
  members: BudgetTeamMember[]
  source: BudgetTeamSource
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

export type BudgetState = {
  plan: BudgetPlanState
  team: BudgetTeamState
}

export type BudgetDepartmentTotal = {
  dept: BudgetDepartment
  total: number
  lines: BudgetLineAmounts
}

export type BudgetSummary = {
  annualBudgetUsd: number
  monthlyAverageUsd: number
  activeHeadcount: number
  terminatedHeadcount: number
  totalCompUsd: number
}

export type BudgetHeadcountByDepartment = {
  dept: BudgetDepartment
  count: number
  terminatedCount: number
  salaryUsd: number
  bonusUsd: number
  totalCompUsd: number
  salaryActualUsd: number
  bonusActualUsd: number
  totalActualUsd: number
  compVarianceUsd: number | null
}

export type BudgetHeadcountActualEntry = {
  dept: BudgetDepartment
  salaryActualUsd: number
  bonusActualUsd: number
  totalActualUsd: number
}

export type BudgetHeadcountActualsState = {
  source: 'quickbooks'
  year: number
  view: BudgetViewState
  fetchedAt: string
  mappingSource: BudgetQbMappingSource
  departments: BudgetHeadcountActualEntry[]
  unclassifiedSalaryUsd: number
  unclassifiedBonusUsd: number
  unclassifiedTotalUsd: number
}

export type BudgetHeadcountSummary = {
  activeHeadcount: number
  totalSalaryBudgetUsd: number
  totalSalaryActualUsd: number
  totalBonusBudgetUsd: number
  totalBonusActualUsd: number
  totalCompBudgetUsd: number
  totalCompActualUsd: number
  monthlyPayrollBudgetUsd: number
}

export type BudgetTeamSummary = {
  totalMembers: number
  activeMembers: number
  terminatedMembers: number
  totalSalaryUsd: number
  totalBonusUsd: number
  totalCompUsd: number
  monthlyPayrollUsd: number
}

export type BudgetDepartmentLineItem = {
  key: BudgetLineCode
  label: string
  category: string
  annualBudgetUsd: number
  monthlyBudgetUsd: number
  sharePct: number
}

export type BudgetLineDiffStatus = 'added' | 'removed' | 'changed'

export type BudgetLineDiffEntry = {
  key: BudgetLineCode
  label: string
  category: string
  beforeUsd: number
  afterUsd: number
  deltaUsd: number
  status: BudgetLineDiffStatus
}

export type BudgetImportPreviewDepartment = {
  department: BudgetDepartment
  rowsProcessed: number
  keysImported: number
  unmappedLineItems: string[]
  importedPeriods: BudgetPeriodKey[]
  existingPeriods: BudgetPeriodKey[]
  diff: BudgetLineDiffEntry[]
}

export type BudgetImportPreviewResult = {
  success: true
  mode: 'preview'
  year: number
  period: BudgetPeriodKey
  importedPeriods: BudgetPeriodKey[]
  departmentsProcessed: BudgetDepartment[]
  departmentsMissing: BudgetDepartment[]
  existingDepartments: BudgetDepartment[]
  preview: BudgetImportPreviewDepartment[]
}

export type BudgetImportSuccessResult = {
  success: true
  mode: 'import'
  year: number
  period: BudgetPeriodKey
  importedPeriods: BudgetPeriodKey[]
  departmentsProcessed: BudgetDepartment[]
  departmentsMissing: BudgetDepartment[]
  existingDepartments: BudgetDepartment[]
  totalRows: number
  totalKeys: number
  unmappedLineItems: string[]
  importedAt: string
}

export type BudgetImportHistoryEntry = {
  sha: string
  message: string
  committedAt: string | null
  authorName: string | null
  restorable: boolean
  isCurrent: boolean
}

export type BudgetImportRecoveryInfo = {
  year: number
  department: BudgetDepartment
  filePath: string
  hasImportedPlan: boolean
  periods: BudgetPeriodKey[]
  importMeta: BudgetImportMeta | null
  history: BudgetImportHistoryEntry[]
}

export type BudgetTeamMutationResult = {
  success: true
  year: number
  action: 'create-member' | 'update-member' | 'terminate-member' | 'restore-member'
  memberId: string
  team: BudgetTeamState
}

export type BudgetViewState = {
  year: number
  entity: BudgetEntityScope
  mode: BudgetViewMode
  month: number
  rangeStart: number
  rangeEnd: number
}

export type BudgetQbMappingRow = {
  cat: string
  line: string
  key: BudgetLineCode
  accounts: number[]
}

export type BudgetQbMappingSource = 'default-static' | 'data-branch'

export type BudgetQbMappingState = {
  version: 1
  year: number
  rows: BudgetQbMappingRow[]
  source: BudgetQbMappingSource
  lastUpdatedAt: string | null
}

export type BudgetQbMappingDuplicate = {
  accountNumber: number
  lineKeys: string[]
  lineLabels: string[]
}

export type BudgetQbMappingMutationResult = {
  success: true
  year: number
  mapping: BudgetQbMappingState
}

export type BudgetActualLineSet = {
  period: BudgetLineAmounts
  ytd: BudgetLineAmounts
  annual: BudgetLineAmounts
}

export type BudgetOverviewActualsState = {
  source: 'quickbooks'
  year: number
  view: BudgetViewState
  fetchedAt: string
  mappingSource: BudgetQbMappingSource
  lines: BudgetActualLineSet
}

export type BudgetRevenueMonthEntry = {
  month: BudgetMonthKey
  periodStart: string
  actualUsd: number
}

export type BudgetRevenueMonthlyBreakdown = {
  year: number
  accountNumber: string
  entity: string
  months: BudgetRevenueMonthEntry[]
  ytdTotalUsd: number
  annualTotalUsd: number
  fetchedAt: string
}

export type BudgetDepartmentActualsState = {
  source: 'quickbooks'
  year: number
  view: BudgetViewState
  department: BudgetDepartmentActualScope
  fetchedAt: string
  mappingSource: BudgetQbMappingSource
  lines: BudgetActualLineSet
  unclassifiedLines: BudgetActualLineSet
}

export type BudgetQbMappingExclusionRow = {
  accountNumber: string
  reason: string
  updatedAt: string | null
}

export type BudgetCoverageStaleMapping = {
  accountNumber: string
  accountName: string | null
  mappingKey: string
  mappingLine: string
  inCatalog: boolean
}

export type BudgetCoverageAccountEntry = {
  accountNumber: string
  accountName: string | null
  amountUsd: number
  pctOfTotal: number
  mappingKey: string | null
  mappingLine: string | null
  exclusionReason: string | null
}

export type BudgetCoverageState = {
  source: 'quickbooks'
  year: number
  view: BudgetViewState
  fetchedAt: string
  mappingSource: BudgetQbMappingSource
  totalQbUsd: number
  mappedUsd: number
  unmappedUsd: number
  excludedUsd: number
  coveragePct: number
  mappedAccounts: BudgetCoverageAccountEntry[]
  unmappedAccounts: BudgetCoverageAccountEntry[]
  excludedAccounts: BudgetCoverageAccountEntry[]
  staleMappings: BudgetCoverageStaleMapping[]
  orphanedMappings: BudgetCoverageStaleMapping[]
}

export type BudgetReportCell = {
  budgetUsd: number | null
  actualUsd: number | null
  varianceUsd: number | null
}

export type BudgetReportColumnKey = 'period' | 'ytd' | 'annual'

export type BudgetReportRowTone = 'default' | 'revenue' | 'subtotal' | 'grand-total'

export type BudgetReportRow = {
  kind: 'category' | 'line' | 'total'
  key: string
  label: string
  category: string
  budgetKeys?: string[] | null
  actualKeys?: string[] | null
  tone?: BudgetReportRowTone
  cells: Record<BudgetReportColumnKey, BudgetReportCell>
  // Net annual adjustment applied to this row's line item(s) this year (signed).
  // 0/undefined when nothing was adjusted. `adjustmentByDepartment` attributes
  // it per department for the All-Departments breakdown.
  adjustmentUsd?: number
  adjustmentByDepartment?: Array<{ department: string; amountUsd: number }>
}

export type BudgetPlanBreakdownEntry = {
  department: BudgetDepartmentActualScope
  amountUsd: number
  pctOfTotal: number
}

export type BudgetPlanBreakdownState = {
  year: number
  view: BudgetViewState
  column: BudgetReportColumnKey
  rowKey: string
  rowLabel: string
  totalUsd: number
  entries: BudgetPlanBreakdownEntry[]
}

export type BudgetActualDrillTransaction = {
  id: string
  entity: string
  realmId: string | null
  txnId: string | null
  accountNumber: string
  accountName: string | null
  splitName: string | null
  date: string | null
  transactionType: string | null
  documentNumber: string | null
  name: string | null
  className: string | null
  normalizedDepartment: BudgetDepartment | null
  memo: string | null
  amountUsd: number
}

export type BudgetActualDrillAccountSummary = {
  accountNumber: string
  accountName: string | null
  amountUsd: number
  transactionCount: number
  mappingKeys: string[]
  mappingLines: string[]
}

export type BudgetActualDrillState = {
  source: 'quickbooks'
  year: number
  view: BudgetViewState
  department: BudgetDepartmentActualScope | null
  fetchedAt: string
  mappingSource: BudgetQbMappingSource
  lineKeys: string[]
  totalUsd: number
  unreconciledTotalUsd: number
  accounts: BudgetActualDrillAccountSummary[]
  transactions: BudgetActualDrillTransaction[]
}

export type BudgetReportTableModel = {
  title: string
  subtitle?: string | null
  helperText?: string | null
  entityLabel: string
  periodLabel: string
  ytdLabel: string
  annualLabel: string
  actualsStatus: 'placeholder' | 'live'
  actualDrillOpenMode: 'positive-only' | 'non-zero'
  rows: BudgetReportRow[]
}
