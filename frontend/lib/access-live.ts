import type { AccessMeResponse } from './access-model.ts'
import { normalizeEmail } from './access-model.ts'

export type AccessRealtimeTable =
  | 'user_access'
  | 'user_access_departments'
  | 'user_access_aliases'
  | 'budget_access_settings'

export type AccessRealtimeSubscriptionSpec = {
  table: AccessRealtimeTable
  filter?: string
}

function normalizeOptionalEmail(email: string | null | undefined): string | null {
  if (!email) return null
  return normalizeEmail(email)
}

export function getAccessRealtimeWatchedEmails(
  authEmail: string | null | undefined,
  access: AccessMeResponse | null,
): string[] {
  const emails = new Set<string>()

  for (const candidate of [
    authEmail,
    access?.email ?? null,
    access?.canonicalEmail ?? null,
  ]) {
    const normalized = normalizeOptionalEmail(candidate)
    if (normalized) {
      emails.add(normalized)
    }
  }

  return Array.from(emails).sort((left, right) => left.localeCompare(right))
}

export function buildAccessRealtimeSubscriptionSpecs(
  authEmail: string | null | undefined,
  access: AccessMeResponse | null,
  year?: number | null,
): AccessRealtimeSubscriptionSpec[] {
  const watchedEmails = getAccessRealtimeWatchedEmails(authEmail, access)
  const specs: AccessRealtimeSubscriptionSpec[] = []

  for (const email of watchedEmails) {
    specs.push({ table: 'user_access', filter: `email=eq.${email}` })
    specs.push({ table: 'user_access_departments', filter: `email=eq.${email}` })
  }

  const normalizedAuthEmail = normalizeOptionalEmail(authEmail)
  if (normalizedAuthEmail) {
    specs.push({ table: 'user_access_aliases', filter: `alias_email=eq.${normalizedAuthEmail}` })
  }

  if (Number.isFinite(year)) {
    specs.push({ table: 'budget_access_settings', filter: `year=eq.${year}` })
  }

  const deduped = new Map<string, AccessRealtimeSubscriptionSpec>()
  for (const spec of specs) {
    const key = `${spec.table}:${spec.filter ?? '*'}`
    if (!deduped.has(key)) {
      deduped.set(key, spec)
    }
  }

  return Array.from(deduped.values())
}
