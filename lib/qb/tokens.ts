import type { QboConnection } from './types.ts'

export const QBO_EXPIRES_AT_SKEW_MS = 60_000
export const QBO_REFRESH_WINDOW_MS = 5 * 60_000

export function computeQboExpiresAt(expiresInSeconds: number, nowMs = Date.now()): string {
  const ttlMs = Math.max(0, expiresInSeconds * 1000 - QBO_EXPIRES_AT_SKEW_MS)
  return new Date(nowMs + ttlMs).toISOString()
}

export function normalizeQboExpiresAt(value: string | number | Date): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return new Date(value).toISOString()
  return new Date(value).toISOString()
}

export function isQboExpired(expiresAt: string | number | Date, nowMs = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= nowMs
}

export function isQboExpiringSoon(
  expiresAt: string | number | Date,
  nowMs = Date.now(),
  refreshWindowMs = QBO_REFRESH_WINDOW_MS,
): boolean {
  return new Date(expiresAt).getTime() <= nowMs + refreshWindowMs
}

export function getQboConnectionStatus(connection: QboConnection, nowMs = Date.now()) {
  return {
    connected: true,
    expired: isQboExpired(connection.expiresAt, nowMs),
    expiringSoon: isQboExpiringSoon(connection.expiresAt, nowMs),
  }
}
