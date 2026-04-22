import { BUDGET_QBO_ENTITIES, type QboEntity } from '../qb/config.ts'
import type { QboConnectionStatus } from '../qb/types.ts'

import type { BudgetEntityScope } from './types.ts'

export function getRequiredQboEntities(entity: BudgetEntityScope): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

export function getMissingQboEntities(
  entity: BudgetEntityScope,
  statuses: readonly QboConnectionStatus[],
): QboEntity[] {
  const byEntity = new Map(statuses.map((status) => [status.entity, status]))
  return getRequiredQboEntities(entity).filter((requiredEntity) => !byEntity.get(requiredEntity)?.connected)
}

export function canFetchBudgetActuals(
  entity: BudgetEntityScope,
  statuses: readonly QboConnectionStatus[],
): boolean {
  return getMissingQboEntities(entity, statuses).length === 0
}

export function formatQboStatusSummary(
  entity: BudgetEntityScope,
  statuses: readonly QboConnectionStatus[],
): string {
  const required = getRequiredQboEntities(entity)
  const connected = required.filter((requiredEntity) =>
    statuses.some((status) => status.entity === requiredEntity && status.connected),
  )

  return `QB: ${connected.length}/${required.length} connected`
}
