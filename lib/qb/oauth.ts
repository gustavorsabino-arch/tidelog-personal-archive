import crypto from 'crypto'

import { getQboRealmId, isQboEntity } from './config.ts'
import type { QboOAuthStatePayload } from './types.ts'

export const QBO_OAUTH_STATE_MAX_AGE_MS = 2 * 60 * 60 * 1000

function signQboOAuthPayload(encodedPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

export function createQboOAuthState(
  payload: Omit<QboOAuthStatePayload, 'ts'> & { ts?: number },
  secret: string,
): string {
  const signedPayload: QboOAuthStatePayload = {
    ...payload,
    ts: payload.ts ?? Date.now(),
  }
  const encodedPayload = Buffer.from(JSON.stringify(signedPayload)).toString('base64url')
  return `${encodedPayload}.${signQboOAuthPayload(encodedPayload, secret)}`
}

export function parseQboOAuthState(state: string, secret: string): QboOAuthStatePayload | null {
  const [encodedPayload, signature] = state.split('.')
  if (!encodedPayload || !signature) return null

  const expectedSignature = signQboOAuthPayload(encodedPayload, secret)
  const expected = Buffer.from(expectedSignature)
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as QboOAuthStatePayload
    if (!payload || typeof payload !== 'object') return null
    if (!isQboEntity(payload.entity)) return null
    if (payload.realmId !== getQboRealmId(payload.entity)) return null
    if (typeof payload.ts !== 'number' || !Number.isFinite(payload.ts)) return null
    if (payload.email !== undefined && typeof payload.email !== 'string') return null
    return payload
  } catch {
    return null
  }
}

export function isQboOAuthStateFresh(
  payload: QboOAuthStatePayload,
  nowMs = Date.now(),
  maxAgeMs = QBO_OAUTH_STATE_MAX_AGE_MS,
): boolean {
  return payload.ts <= nowMs + 60_000 && nowMs - payload.ts <= maxAgeMs
}
