import { normalizeEmail } from './access-model.ts'

export type AccessAuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'
  | string

function normalizeOptionalEmail(email: string | null | undefined): string | null {
  if (!email) return null
  return normalizeEmail(email)
}

export function shouldRefreshAccessForAuthEvent(
  event: AccessAuthChangeEvent,
  previousEmail: string | null | undefined,
  nextEmail: string | null | undefined,
): boolean {
  const normalizedPreviousEmail = normalizeOptionalEmail(previousEmail)
  const normalizedNextEmail = normalizeOptionalEmail(nextEmail)

  if (normalizedPreviousEmail !== normalizedNextEmail) {
    return true
  }

  if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
    return true
  }

  return false
}
