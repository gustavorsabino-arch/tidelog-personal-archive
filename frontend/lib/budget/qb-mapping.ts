import { readDataFileStrict } from '../github.ts'
import {
  BUDGET_LINE_CATALOG,
  BUDGET_LINE_ENTRY_BY_KEY,
  normalizeBudgetLineKey,
} from './catalog.ts'
import type {
  BudgetQbMappingDuplicate,
  BudgetQbMappingRow,
  BudgetQbMappingSource,
  BudgetQbMappingState,
} from './types.ts'

type BudgetQbMappingStateInput = Partial<Omit<BudgetQbMappingState, 'rows'>> & {
  rows?: Array<Partial<BudgetQbMappingRow>>
}

export const DEFAULT_BUDGET_QB_MAPPING_ROWS: BudgetQbMappingRow[] = [
  { cat: 'Compensation & Benefits', line: 'Salaries & Wages', key: 'salary', accounts: [60110, 60310] },
  { cat: 'Compensation & Benefits', line: 'Bonus', key: 'bonus', accounts: [60120, 60320] },
  { cat: 'Compensation & Benefits', line: 'Commissions', key: 'commissions', accounts: [60140, 60340] },
  { cat: 'Compensation & Benefits', line: 'Benefits', key: 'benefits', accounts: [60130, 60330, 60510, 60520] },
  { cat: 'Compensation & Benefits', line: 'Payroll Taxes', key: 'payroll', accounts: [60150] },
  { cat: 'Compensation & Benefits', line: 'Severance Pay', key: 'severance', accounts: [60160, 60350] },
  { cat: 'Software & SaaS', line: 'Department Tools', key: 'epdTools', accounts: [61010] },
  { cat: 'Software & SaaS', line: 'Company Tools', key: 'bizTools', accounts: [61020] },
  { cat: 'Hosting & Infrastructure', line: 'Cloud Hosting & Compute', key: 'hosting', accounts: [61110] },
  { cat: 'Hosting & Infrastructure', line: 'Blockchain & RPC', key: 'blockchainRpc', accounts: [61120] },
  { cat: 'Hosting & Infrastructure', line: 'Security & Monitoring', key: 'securityMon', accounts: [61130] },
  { cat: 'HR & Recruiting', line: 'HR Costs', key: 'hrCosts', accounts: [63020, 63030, 63040, 63050] },
  { cat: 'HR & Recruiting', line: 'Third-Party & Referrals', key: 'recruiting', accounts: [63010] },
  { cat: 'Marketing Expense', line: 'Events', key: 'meals', accounts: [65030] },
  { cat: 'Marketing Expense', line: 'Other', key: 'mktExp', accounts: [65010, 65020, 65040, 65050, 65099] },
  { cat: 'Travel & Entertainment', line: 'Travel & Entertainment', key: 'travel', accounts: [64010, 64020, 64030, 64040, 64050, 64060, 64070] },
  { cat: 'Travel & Entertainment', line: 'Company Offsite', key: 'colos', accounts: [64110, 64120, 64130, 64140, 64150, 64160, 64170] },
  { cat: 'Professional Services', line: 'Professional Services', key: 'profSvc', accounts: [62010, 62020, 62030, 62050, 62060, 62070] },
  { cat: 'Professional Services', line: 'Corporate Compliance', key: 'corpCompliance', accounts: [62040] },
  { cat: 'Transaction Fees', line: 'Transaction Fees', key: 'bankFees', accounts: [66010, 66020, 66040] },
  { cat: 'Office', line: 'Office', key: 'rent', accounts: [67010, 67020, 67030] },
  { cat: 'Misc Expenses', line: 'Misc Expenses', key: 'hardware', accounts: [69010, 69020, 69040, 69099] },
]

function normalizeAccounts(accounts: unknown): number[] {
  if (!Array.isArray(accounts)) return []

  return Array.from(new Set(
    accounts
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
  )).sort((left, right) => left - right)
}

function normalizeBudgetQbMappingRow(row: Partial<BudgetQbMappingRow> | null | undefined): BudgetQbMappingRow | null {
  if (!row?.key) return null

  const key = normalizeBudgetLineKey(String(row.key))
  if (!key) return null

  const catalogEntry = BUDGET_LINE_ENTRY_BY_KEY[key]
  const line = String(row.line ?? catalogEntry?.label ?? key).trim()
  const cat = String(row.cat ?? catalogEntry?.category ?? 'Other').trim()
  const accounts = normalizeAccounts(row.accounts)

  return {
    key,
    line: line || catalogEntry?.label || key,
    cat: cat || catalogEntry?.category || 'Other',
    accounts,
  }
}

function mergeBudgetQbMappingRows(rows: Array<Partial<BudgetQbMappingRow>>): BudgetQbMappingRow[] {
  const merged = new Map<string, BudgetQbMappingRow>()

  for (const candidate of rows) {
    const normalized = normalizeBudgetQbMappingRow(candidate)
    if (!normalized) continue

    const existing = merged.get(String(normalized.key))
    if (!existing) {
      merged.set(String(normalized.key), normalized)
      continue
    }

    merged.set(String(normalized.key), {
      ...existing,
      accounts: Array.from(new Set([...existing.accounts, ...normalized.accounts])).sort((left, right) => left - right),
    })
  }

  return sortBudgetQbMappingRows(Array.from(merged.values()))
}

function getBudgetQbMappingSortKey(row: BudgetQbMappingRow): [number, string, string] {
  const catalogIndex = BUDGET_LINE_CATALOG.findIndex((entry) => entry.key === row.key)
  return [catalogIndex >= 0 ? catalogIndex : Number.MAX_SAFE_INTEGER, row.cat.toLowerCase(), row.line.toLowerCase()]
}

export function sortBudgetQbMappingRows(rows: readonly BudgetQbMappingRow[]): BudgetQbMappingRow[] {
  return [...rows].sort((left, right) => {
    const leftKey = getBudgetQbMappingSortKey(left)
    const rightKey = getBudgetQbMappingSortKey(right)

    if (leftKey[0] !== rightKey[0]) return leftKey[0] - rightKey[0]
    if (leftKey[1] !== rightKey[1]) return leftKey[1].localeCompare(rightKey[1])
    return leftKey[2].localeCompare(rightKey[2])
  })
}

export function findBudgetQbMappingDuplicates(rows: readonly BudgetQbMappingRow[]): BudgetQbMappingDuplicate[] {
  const seen = new Map<number, { key: string; line: string }[]>()

  for (const row of rows) {
    for (const account of row.accounts) {
      const entries = seen.get(account) ?? []
      entries.push({ key: row.key, line: row.line })
      seen.set(account, entries)
    }
  }

  return Array.from(seen.entries())
    .filter(([, entries]) => new Set(entries.map((entry) => entry.key)).size > 1)
    .map(([accountNumber, entries]) => ({
      accountNumber,
      lineKeys: Array.from(new Set(entries.map((entry) => entry.key))),
      lineLabels: Array.from(new Set(entries.map((entry) => entry.line))),
    }))
    .sort((left, right) => left.accountNumber - right.accountNumber)
}

export function validateBudgetQbMappingRows(rows: Array<Partial<BudgetQbMappingRow>>): BudgetQbMappingRow[] {
  const normalizedRows = mergeBudgetQbMappingRows(rows)
  const duplicates = findBudgetQbMappingDuplicates(normalizedRows)
  if (duplicates.length > 0) {
    const firstDuplicate = duplicates[0]
    throw new Error(
      `Account ${firstDuplicate.accountNumber} is mapped to multiple budget lines: ${firstDuplicate.lineLabels.join(', ')}.`,
    )
  }

  return normalizedRows
}

export function getBudgetQbMappingPath(year: number): string {
  return `budget/${year}/qb-mapping.json`
}

export function getDefaultBudgetQbMappingState(year: number): BudgetQbMappingState {
  return {
    version: 1,
    year,
    rows: DEFAULT_BUDGET_QB_MAPPING_ROWS.map((row) => ({
      ...row,
      accounts: [...row.accounts],
    })),
    source: 'default-static',
    lastUpdatedAt: null,
  }
}

export function normalizeBudgetQbMappingState(
  input: BudgetQbMappingStateInput | null | undefined,
  year: number,
  source: BudgetQbMappingSource,
): BudgetQbMappingState {
  const fallback = getDefaultBudgetQbMappingState(year)
  const rows = validateBudgetQbMappingRows(input?.rows ?? fallback.rows)

  return {
    version: 1,
    year,
    rows: rows.length > 0 ? rows : fallback.rows,
    source,
    lastUpdatedAt: typeof input?.lastUpdatedAt === 'string' ? input.lastUpdatedAt : null,
  }
}

export async function loadBudgetQbMappingState(year: number, noCache = false): Promise<BudgetQbMappingState> {
  const result = await readDataFileStrict<BudgetQbMappingStateInput>(getBudgetQbMappingPath(year), noCache)
  if (!result.ok || !result.found) {
    return getDefaultBudgetQbMappingState(year)
  }

  try {
    return normalizeBudgetQbMappingState(result.data, year, 'data-branch')
  } catch (error) {
    console.error('[Budget] Failed to normalize QB mapping; falling back to defaults:', error)
    return getDefaultBudgetQbMappingState(year)
  }
}
