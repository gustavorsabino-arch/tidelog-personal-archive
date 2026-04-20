import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

import { getQboEntityFromRealmId, getQboRealmId, isQboEntity, type QboEntity } from './config.ts'
import { getQboConnectionStatus, normalizeQboExpiresAt } from './tokens.ts'
import type { QboConnection, QboConnectionRow, QboConnectionStatus } from './types.ts'

type UpsertQboConnectionInput = {
  entity?: QboEntity
  realmId: string
  accessToken: string
  refreshToken: string
  expiresAt: string | number | Date
  connectedBy?: string | null
}

function mapQboConnectionRow(row: QboConnectionRow): QboConnection {
  if (!isQboEntity(row.entity)) {
    throw new Error(`Unsupported QBO entity in qb_connections: ${row.entity}`)
  }

  return {
    entity: row.entity,
    realmId: row.realm_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    connectedBy: row.connected_by,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function toQboConnectionStatus(connection: QboConnection): QboConnectionStatus {
  const status = getQboConnectionStatus(connection)
  return {
    entity: connection.entity,
    realmId: connection.realmId,
    connected: status.connected,
    expired: status.expired,
    expiringSoon: status.expiringSoon,
    expiresAt: connection.expiresAt,
    updatedAt: connection.updatedAt,
  }
}

function resolveQboConnectionEntity(input: UpsertQboConnectionInput): QboEntity {
  const inferredEntity = getQboEntityFromRealmId(input.realmId)
  if (!inferredEntity) {
    throw new Error(`Unknown QBO realm ID: ${input.realmId}`)
  }

  if (input.entity && input.entity !== inferredEntity) {
    throw new Error(`QBO entity/realm mismatch: ${input.entity} does not match ${input.realmId}`)
  }

  if (getQboRealmId(inferredEntity) !== input.realmId) {
    throw new Error(`QBO realm mapping is inconsistent for ${inferredEntity}`)
  }

  return input.entity ?? inferredEntity
}

export async function getQboConnectionByEntity(entity: QboEntity): Promise<QboConnection | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('qb_connections')
    .select('*')
    .eq('entity', entity)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load QBO connection for ${entity}: ${error.message}`)
  }

  return data ? mapQboConnectionRow(data as QboConnectionRow) : null
}

export async function getQboConnectionByRealmId(realmId: string): Promise<QboConnection | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('qb_connections')
    .select('*')
    .eq('realm_id', realmId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load QBO connection for realm ${realmId}: ${error.message}`)
  }

  return data ? mapQboConnectionRow(data as QboConnectionRow) : null
}

export async function listQboConnections(): Promise<QboConnectionStatus[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('qb_connections')
    .select('*')
    .order('entity', { ascending: true })

  if (error) {
    throw new Error(`Failed to list QBO connections: ${error.message}`)
  }

  return (data as QboConnectionRow[]).map((row) => toQboConnectionStatus(mapQboConnectionRow(row)))
}

export async function upsertQboConnection(input: UpsertQboConnectionInput): Promise<QboConnection> {
  const entity = resolveQboConnectionEntity(input)
  const supabase = createAdminClient()

  const row = {
    entity,
    realm_id: input.realmId,
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
    expires_at: normalizeQboExpiresAt(input.expiresAt),
    connected_by: input.connectedBy?.trim().toLowerCase() || null,
  }

  const { data, error } = await supabase
    .from('qb_connections')
    .upsert(row, { onConflict: 'entity' })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Failed to save QBO connection for ${entity}: ${error.message}`)
  }

  return mapQboConnectionRow(data as QboConnectionRow)
}

export async function deleteQboConnection(entity: QboEntity): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('qb_connections')
    .delete()
    .eq('entity', entity)

  if (error) {
    throw new Error(`Failed to delete QBO connection for ${entity}: ${error.message}`)
  }
}
