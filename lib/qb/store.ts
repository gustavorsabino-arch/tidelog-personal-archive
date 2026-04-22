import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbConnection } from '@/lib/db/schema/quickbooks'

import { getQboEntityFromRealmId, getQboRealmId, isQboEntity, type QboEntity } from './config.ts'
import { getQboConnectionStatus, normalizeQboExpiresAt } from './tokens.ts'
import type { QboConnection, QboConnectionStatus } from './types.ts'

type UpsertQboConnectionInput = {
  entity?: QboEntity
  realmId: string
  accessToken: string
  refreshToken: string
  expiresAt: string | number | Date
  connectedBy?: string | null
}

type QbConnectionRow = typeof qbConnection.$inferSelect

// entityId in DB is lowercase ('opco', 'foundation', ...); QboEntity type is capitalized ('Opco', ...).
// These two helpers normalize at the API boundary.
function entityToId(entity: QboEntity): string {
  return entity.toLowerCase()
}

function idToEntity(id: string): QboEntity {
  const cap = id.charAt(0).toUpperCase() + id.slice(1).toLowerCase()
  if (!isQboEntity(cap)) {
    throw new Error(`Unsupported QBO entity in qb_connection: ${id}`)
  }
  return cap
}

function mapRow(row: QbConnectionRow): QboConnection {
  return {
    entity: idToEntity(row.entityId),
    realmId: row.realmId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt.toISOString(),
    connectedBy: null,   // retired field; Better Auth tracks user actions via audit_log
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
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
  // When the caller supplies an entity explicitly (typical: the UI's Connect
  // QB button for Opco), trust it. The reverse realmId → entity lookup isn't
  // always unique (sandbox testing commonly points every entity at the same
  // company ID), and we already validated the OAuth state upstream.
  if (input.entity) {
    if (!isQboEntity(input.entity)) {
      throw new Error(`Unsupported QBO entity: ${input.entity}`)
    }
    return input.entity
  }

  const inferredEntity = getQboEntityFromRealmId(input.realmId)
  if (!inferredEntity) {
    throw new Error(`Unknown QBO realm ID: ${input.realmId}`)
  }
  if (getQboRealmId(inferredEntity) !== input.realmId) {
    throw new Error(`QBO realm mapping is inconsistent for ${inferredEntity}`)
  }
  return inferredEntity
}

export async function getQboConnectionByEntity(entity: QboEntity): Promise<QboConnection | null> {
  const [row] = await db.select()
    .from(qbConnection)
    .where(eq(qbConnection.entityId, entityToId(entity)))
    .limit(1)
  return row ? mapRow(row) : null
}

export async function getQboConnectionByRealmId(realmId: string): Promise<QboConnection | null> {
  const [row] = await db.select()
    .from(qbConnection)
    .where(eq(qbConnection.realmId, realmId))
    .limit(1)
  return row ? mapRow(row) : null
}

export async function listQboConnections(): Promise<QboConnectionStatus[]> {
  const rows = await db.select().from(qbConnection).orderBy(qbConnection.entityId)
  return rows.map((row) => toQboConnectionStatus(mapRow(row)))
}

export async function upsertQboConnection(input: UpsertQboConnectionInput): Promise<QboConnection> {
  const entity = resolveQboConnectionEntity(input)
  const entityId = entityToId(entity)
  const expiresAt = new Date(normalizeQboExpiresAt(input.expiresAt))
  const now = new Date()

  // qb_connection.entityId is PK — upsert on that so each entity keeps
  // exactly one connection even when multiple entities point at a shared
  // sandbox realm.
  const [row] = await db.insert(qbConnection).values({
    entityId,
    realmId: input.realmId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: qbConnection.entityId,
    set: {
      realmId: input.realmId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt,
      lastRefreshedAt: now,
      updatedAt: now,
    },
  }).returning()

  if (!row) throw new Error(`Failed to save QBO connection for ${entity}`)
  return mapRow(row)
}

export async function deleteQboConnection(entity: QboEntity): Promise<void> {
  await db.delete(qbConnection).where(eq(qbConnection.entityId, entityToId(entity)))
}
