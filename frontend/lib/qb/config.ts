import { BUDGET_ENTITIES } from '../constants.ts'

export const QBO_ENTITIES = ['Opco', 'Foundation', 'Juku', 'Zagreus'] as const

export type QboEntity = (typeof QBO_ENTITIES)[number]
export const BUDGET_QBO_ENTITIES = BUDGET_ENTITIES satisfies readonly QboEntity[]

export const QBO_REALM_IDS: Record<QboEntity, string> = {
  Opco: '9341452247586809',
  Foundation: '9130352128225976',
  Juku: '9130357942134196',
  Zagreus: '9130352128221356',
}

const QBO_REALM_TO_ENTITY = Object.fromEntries(
  Object.entries(QBO_REALM_IDS).map(([entity, realmId]) => [realmId, entity]),
) as Record<string, QboEntity>

export const QBO_BASE_URL = 'https://quickbooks.api.intuit.com'
export const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'

export function isQboEntity(value: string): value is QboEntity {
  return QBO_ENTITIES.includes(value as QboEntity)
}

export function getQboRealmId(entity: QboEntity): string {
  return QBO_REALM_IDS[entity]
}

export function getQboEntityFromRealmId(realmId: string): QboEntity | null {
  return QBO_REALM_TO_ENTITY[realmId] ?? null
}
