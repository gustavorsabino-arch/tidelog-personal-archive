/**
 * Client-side API helper.
 *
 * Auth is handled at the edge by Cloudflare Access — same-origin fetches
 * carry the `Cf-Access-Jwt-Assertion` cookie automatically, and the Next.js
 * proxy verifies it and injects `x-user-*` headers before the request
 * reaches our route handlers. Nothing to attach here.
 */

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string> | undefined),
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
  const res = await fetch(path, {
    ...options,
    method: options.method || 'POST',
    body,
    headers: {
      ...(options.headers as Record<string, string> | undefined),
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
