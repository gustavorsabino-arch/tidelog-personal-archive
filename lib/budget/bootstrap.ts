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

// The bootstrap response intentionally contains an empty team. Its request can
// finish after the separate roster request, so keep the roster already loaded.
export function mergeBudgetPlanWithCurrentTeam(current: BudgetState, incoming: BudgetState): BudgetState {
  return {
    ...incoming,
    team: current.team.year === incoming.team.year ? current.team : incoming.team,
  }
}
