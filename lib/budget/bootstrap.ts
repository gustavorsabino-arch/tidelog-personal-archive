import type { QboConnectionStatus } from '@/lib/qb/types'

import type { BudgetState } from './types'

export type BudgetBootstrapResponse = {
  state: BudgetState
  qbStatuses: QboConnectionStatus[]
  qbStatusError: string | null
  allowedBudgetMonthIndices: number[] | null
}
