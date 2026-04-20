import { BUDGET_DEPTS } from '../constants.ts'
import type { BudgetDepartment } from './types.ts'

const NORMALIZED_DEPARTMENT_BY_TOKEN: Record<string, BudgetDepartment> = Object.fromEntries(
  BUDGET_DEPTS.flatMap((department) => {
    const normalized = normalizeBudgetDepartmentToken(department)
    const entries: Array<[string, BudgetDepartment]> = [[normalized, department]]

    if (department === 'Finance') {
      // Accept the longer v2-era name and its separator variants so any persisted
      // 'Finance & Accounting' value (QB class, workbook sheet, imported plan) still
      // resolves to the canonical 'Finance' department.
      entries.push(
        ['finance and accounting', department],
        ['finance accounting', department],
      )
    }

    if (department === 'Business Development') {
      entries.push(['business development', department], ['biz dev', department], ['bd', department])
    }

    if (department === 'Legal') {
      entries.push(['governance', department], ['council', department])
    }

    return entries
  }),
) as Record<string, BudgetDepartment>

export function normalizeBudgetDepartmentToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeBudgetDepartmentName(rawDepartment: string | null | undefined): BudgetDepartment | null {
  const value = String(rawDepartment ?? '').trim()
  if (!value) return null

  const candidates = Array.from(new Set([
    value,
    value.split(':')[0]?.trim() ?? '',
    value.split(':').at(-1)?.trim() ?? '',
  ].filter(Boolean).map(normalizeBudgetDepartmentToken)))

  for (const candidate of candidates) {
    const direct = NORMALIZED_DEPARTMENT_BY_TOKEN[candidate]
    if (direct) return direct
  }

  for (const candidate of candidates) {
    for (const department of BUDGET_DEPTS) {
      const normalizedDepartment = normalizeBudgetDepartmentToken(department)
      if (candidate.startsWith(normalizedDepartment) || normalizedDepartment.startsWith(candidate)) {
        return department
      }
    }
  }

  return null
}

export function getBudgetDepartmentLabel(department: string | null | undefined): string {
  const value = String(department ?? '').trim()
  if (!value) return ''
  return value
}

export function formatBudgetDepartmentList(departments: readonly (string | null | undefined)[]): string {
  return departments
    .map((department) => getBudgetDepartmentLabel(department))
    .filter(Boolean)
    .join(', ')
}
