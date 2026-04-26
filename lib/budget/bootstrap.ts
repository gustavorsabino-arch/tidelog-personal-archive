import type { QboConnectionStatus } from '@/lib/qb/types'

import type { BudgetState } from './types'

export type BudgetBootstrapResponse = {
  state: BudgetState
  // null when the requester is not an admin — viewers don't have permission
  // to see QB connection details (realm IDs, refresh metadata, etc.).
  qbStatuses: QboConnectionStatus[] | null
  qbStatusError: string | null
  allowedBudgetMonthIndices: number[] | null
}
