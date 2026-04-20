import type { QboEntity } from './config.ts'

export type QboConnectionRow = {
  entity: string
  realm_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  connected_by: string | null
  created_at: string
  updated_at: string
}

export type QboConnection = {
  entity: QboEntity
  realmId: string
  accessToken: string
  refreshToken: string
  expiresAt: string
  connectedBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type QboConnectionStatus = {
  entity: QboEntity
  realmId: string
  connected: boolean
  expiresAt: string | null
  expired: boolean
  expiringSoon: boolean
  updatedAt: string | null
}

export type QboStatusResponse = {
  entities: QboConnectionStatus[]
}

export type QboOAuthStatePayload = {
  entity: QboEntity
  realmId: string
  ts: number
  email?: string
}
