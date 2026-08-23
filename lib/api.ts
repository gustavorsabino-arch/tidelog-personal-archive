/**
 * Client-side API helper.
 *
 * Auth is handled at the edge by Cloudflare Access — same-origin fetches
 * carry the `Cf-Access-Jwt-Assertion` cookie automatically, and the Next.js
 * proxy verifies it and injects `x-user-*` headers before the request
 * reaches our route handlers. Nothing to attach here.
 */

/**
 * Build a readable Error from a failed response. Our route handlers always
 * return `{ error: string }`, but platform-level failures (middleware crash,
 * function timeout) answer with plain text or HTML and no reason phrase on
 * HTTP/2 — without this, those surface as a blank "API error: 500".
 */
async function responseError(res: Response): Promise<Error & { status?: number; payload?: unknown }> {
  const text = await res.text().catch(() => '')
  let payload: { error?: unknown } = {}
  try { payload = JSON.parse(text) } catch { /* non-JSON body */ }
  const fromBody = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : ''
  const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
  const error = new Error(
    fromBody || (snippet ? `HTTP ${res.status} — ${snippet}` : `API error: ${res.status}`),
  ) as Error & { status?: number; payload?: unknown }
  error.status = res.status
  error.payload = payload
  return error
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) {
    throw await responseError(res)
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
    throw await responseError(res)
  }

  return res.json()
}
