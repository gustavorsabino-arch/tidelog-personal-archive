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

// ── QuickBooks Online API v3 — typed responses & journal entry payloads ──────

export type QbVendor = {
  Id: string
  DisplayName: string
}

export type QbJournalEntryLineDetail = {
  PostingType: 'Debit' | 'Credit'
  AccountRef: { value: string; name?: string }
  Entity?: { Type: 'Vendor'; EntityRef: { value: string } }
  ClassRef?: { value: string; name?: string }
}

export type QbJournalEntryLine = {
  Id?: string
  DetailType: 'JournalEntryLineDetail'
  Amount: number
  Description?: string
  JournalEntryLineDetail: QbJournalEntryLineDetail
}

export type QbJournalEntry = {
  Id?: string
  DocNumber: string
  TxnDate: string // YYYY-MM-DD
  PrivateNote: string // idempotency UUID — D11
  Line: QbJournalEntryLine[]
}

// Generic wrapper around `SELECT … FROM <Entity>` query responses.
// Caller specifies the entity key (e.g. `Vendor`, `JournalEntry`) and row type.
export type QbQueryResponse<K extends string, T> = {
  QueryResponse?: Partial<Record<K, T[]>> & {
    startPosition?: number
    maxResults?: number
    totalCount?: number
  }
  time?: string
}

// Response wrapper for create/update JE POSTs.
export type QbJournalEntryResponse = {
  JournalEntry: QbJournalEntry & { Id: string; SyncToken?: string }
  time?: string
}
