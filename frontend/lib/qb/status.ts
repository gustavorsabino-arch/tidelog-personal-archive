import 'server-only'

import { BUDGET_QBO_ENTITIES, getQboRealmId } from './config'
import { listQboConnections } from './store'
import type { QboConnectionStatus } from './types'

export async function loadQboStatuses(): Promise<QboConnectionStatus[]> {
  const connectedStatuses = await listQboConnections()
  const connectedByEntity = new Map(connectedStatuses.map((entry) => [entry.entity, entry]))

  return BUDGET_QBO_ENTITIES.map((entity) => (
    connectedByEntity.get(entity) ?? {
      entity,
      realmId: getQboRealmId(entity),
      connected: false,
      expired: false,
      expiringSoon: false,
      expiresAt: null,
      updatedAt: null,
    }
  ))
}
