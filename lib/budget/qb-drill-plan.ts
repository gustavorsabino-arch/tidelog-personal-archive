import type { QboEntity } from '../qb/config.ts'

const REVENUE_ACCOUNT_NUMBER = '40110'

export type BudgetActualDrillTask = {
  entity: QboEntity
  accountNumber: string
}

export type BudgetActualDrillPlannedTask = BudgetActualDrillTask & {
  accountTotal: number
}

export function normalizeBudgetActualDrillAccountTotal(accountNumber: string, amount: number): number {
  return accountNumber === REVENUE_ACCOUNT_NUMBER ? Math.abs(amount) : amount
}

export function attachBudgetActualDrillControlTotals(
  tasks: readonly BudgetActualDrillTask[],
  accountTotalsByEntity: Record<string, Record<string, number>>,
): BudgetActualDrillPlannedTask[] {
  return tasks.map((task) => ({
    ...task,
    accountTotal: normalizeBudgetActualDrillAccountTotal(
      task.accountNumber,
      accountTotalsByEntity[task.entity]?.[task.accountNumber] ?? 0,
    ),
  }))
}
