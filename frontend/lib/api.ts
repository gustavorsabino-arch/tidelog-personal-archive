/**
 * Client-side API helper.
 * Wraps fetch with Supabase JWT auth for API route calls.
 */
import { createClient } from '@/lib/supabase/client'

async function getAuthHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {}
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      h['Authorization'] = `Bearer ${session.access_token}`
    }
  } catch { /* not in browser */ }
  return h
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.headers as Record<string, string> || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API error: ${res.status}`)
  }
  return res.json()
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function apiFormFetch<T>(path: string, body: FormData, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(path, {
    ...options,
    method: options.method || 'POST',
    body,
    headers: {
      ...authHeaders,
      ...(options.headers as Record<string, string> || {}),
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    const error = new Error(err.error || `API error: ${res.status}`) as Error & {
      status?: number
      payload?: unknown
    }
    error.status = res.status
    error.payload = err
    throw error
  }

  return res.json()
}
