import { BUDGET_ENTITIES } from '../constants.ts'

export const QBO_ENTITIES = ['Opco', 'Foundation', 'Juku', 'Zagreus'] as const

export type QboEntity = (typeof QBO_ENTITIES)[number]
export const BUDGET_QBO_ENTITIES = BUDGET_ENTITIES satisfies readonly QboEntity[]

// Per-entity production realm IDs. Override per entity via
// QB_REALM_OPCO / QB_REALM_FOUNDATION / QB_REALM_JUKU / QB_REALM_ZAGREUS in
// .env.local when testing against sandbox companies.
const DEFAULT_QBO_REALM_IDS: Record<QboEntity, string> = {
  Opco: '9341452247586809',
  Foundation: '9130352128225976',
  Juku: '9130357942134196',
  Zagreus: '9130352128221356',
}

const QBO_REALM_ENV_VARS: Record<QboEntity, string> = {
  Opco: 'QB_REALM_OPCO',
  Foundation: 'QB_REALM_FOUNDATION',
  Juku: 'QB_REALM_JUKU',
  Zagreus: 'QB_REALM_ZAGREUS',
}

export const QBO_REALM_IDS: Record<QboEntity, string> = Object.fromEntries(
  (Object.keys(DEFAULT_QBO_REALM_IDS) as QboEntity[]).map((entity) => [
    entity,
    process.env[QBO_REALM_ENV_VARS[entity]]?.trim() || DEFAULT_QBO_REALM_IDS[entity],
  ]),
) as Record<QboEntity, string>

const QBO_REALM_TO_ENTITY = Object.fromEntries(
  Object.entries(QBO_REALM_IDS).map(([entity, realmId]) => [realmId, entity]),
) as Record<string, QboEntity>

// Override for sandbox: set QB_API_BASE_URL=https://sandbox-quickbooks.api.intuit.com
export const QBO_BASE_URL = process.env.QB_API_BASE_URL?.trim() || 'https://quickbooks.api.intuit.com'
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
