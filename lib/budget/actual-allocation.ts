import type {
  BudgetActualDrillTransaction,
  BudgetDepartment,
  BudgetDepartmentActualScope,
} from './types.ts'
import { isExcludedBudgetQboClassName } from './qb-class.ts'

export type BudgetActualScopeAllocation = {
  allTransactions: BudgetActualDrillTransaction[]
  transactionTotalUsd: number
  unresolvedTotalUsd: number
  unclassifiedTransactions: BudgetActualDrillTransaction[]
  unclassifiedTotalUsd: number
  departmentTransactions: Partial<Record<BudgetDepartment, BudgetActualDrillTransaction[]>>
  departmentTotals: Partial<Record<BudgetDepartment, number>>
}

export type BudgetActualScopeContribution = {
  transactions: BudgetActualDrillTransaction[]
  transactionTotalUsd: number
  unresolvedTotalUsd: number
  totalUsd: number
}

export function buildBudgetActualScopeAllocation(
  transactions: readonly BudgetActualDrillTransaction[],
  accountTotalUsd: number,
): BudgetActualScopeAllocation {
  const allTransactions = transactions.filter(
    (transaction) => !isExcludedBudgetQboClassName(transaction.className),
  )
  const departmentTransactions: Partial<Record<BudgetDepartment, BudgetActualDrillTransaction[]>> = {}
  const departmentTotals: Partial<Record<BudgetDepartment, number>> = {}
  const unclassifiedTransactions: BudgetActualDrillTransaction[] = []
  let transactionTotalUsd = 0
  let unclassifiedTotalUsd = 0

  for (const transaction of allTransactions) {
    transactionTotalUsd += transaction.amountUsd

    if (transaction.normalizedDepartment) {
      const department = transaction.normalizedDepartment
      const existingTransactions = departmentTransactions[department] ?? []
      existingTransactions.push(transaction)
      departmentTransactions[department] = existingTransactions
      departmentTotals[department] = (departmentTotals[department] ?? 0) + transaction.amountUsd
      continue
    }

    unclassifiedTransactions.push(transaction)
    unclassifiedTotalUsd += transaction.amountUsd
  }

  const unresolvedTotalUsd = accountTotalUsd - transactionTotalUsd

  return {
    allTransactions,
    transactionTotalUsd,
    unresolvedTotalUsd: Math.abs(unresolvedTotalUsd) > 0.005 ? unresolvedTotalUsd : 0,
    unclassifiedTransactions,
    unclassifiedTotalUsd,
    departmentTransactions,
    departmentTotals,
  }
}

export function getBudgetActualScopeContribution(
  allocation: BudgetActualScopeAllocation,
  department: BudgetDepartmentActualScope | null,
): BudgetActualScopeContribution {
  if (department === null) {
    return {
      transactions: allocation.allTransactions,
      transactionTotalUsd: allocation.transactionTotalUsd,
      unresolvedTotalUsd: allocation.unresolvedTotalUsd,
      totalUsd: allocation.transactionTotalUsd + allocation.unresolvedTotalUsd,
    }
  }

  if (department === 'Not specified') {
    return {
      transactions: allocation.unclassifiedTransactions,
      transactionTotalUsd: allocation.unclassifiedTotalUsd,
      unresolvedTotalUsd: allocation.unresolvedTotalUsd,
      totalUsd: allocation.unclassifiedTotalUsd + allocation.unresolvedTotalUsd,
    }
  }

  const transactions = allocation.departmentTransactions[department] ?? []
  const transactionTotalUsd = allocation.departmentTotals[department] ?? 0

  return {
    transactions,
    transactionTotalUsd,
    unresolvedTotalUsd: 0,
    totalUsd: transactionTotalUsd,
  }
}
