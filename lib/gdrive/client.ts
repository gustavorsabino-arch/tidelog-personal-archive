import 'server-only'
import { createSign } from 'node:crypto'

/**
 * Minimal Google Drive client for mirroring approval attachments into the
 * company Drive. Service-account JWT flow signed with node:crypto — no SDK
 * dependency. The service account can only touch what was explicitly shared
 * with it (the dedicated "Tidelog Evidence" folder), never the whole Drive.
 *
 * Dormant without config:
 *   GDRIVE_SERVICE_ACCOUNT_KEY — the full JSON key file content
 *   GDRIVE_APPROVALS_FOLDER_ID — the destination folder's ID (from its URL)
 *
 * Best-effort by design: uploads are bounded by timeouts and every error is
 * swallowed after logging. Postgres remains the source of truth for
 * attachments; Drive is a convenience mirror.
 */

type ServiceAccountKey = { client_email: string; private_key: string }

const TOKEN_TIMEOUT_MS = 8_000
const UPLOAD_TIMEOUT_MS = 20_000

function loadKey(): ServiceAccountKey | null {
  const raw = process.env.GDRIVE_SERVICE_ACCOUNT_KEY
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ServiceAccountKey
    if (!parsed.client_email || !parsed.private_key) return null
    return parsed
  } catch {
    console.error('[gdrive] GDRIVE_SERVICE_ACCOUNT_KEY is not valid JSON')
    return null
  }
}

export function gdriveEnabled(): boolean {
  return !!process.env.GDRIVE_APPROVALS_FOLDER_ID && loadKey() !== null
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Access token cached per instance; Google tokens live 1h, refresh at 50min.
let cachedToken: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  const key = loadKey()
  if (!key) return null

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claims}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key)
  const assertion = `${unsigned}.${b64url(signature)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS)
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: controller.signal,
    })
    const body = await res.json() as { access_token?: string; error?: string; error_description?: string }
    if (!res.ok || !body.access_token) {
      console.error('[gdrive] token exchange failed:', body.error, body.error_description)
      return null
    }
    cachedToken = { value: body.access_token, expiresAt: Date.now() + 50 * 60 * 1000 }
    return body.access_token
  } catch (err) {
    console.error('[gdrive] token exchange error:', (err as Error).message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type DriveUploadResult = { id: string; webViewLink: string | null }

/** Upload one file into the approvals folder. Returns null on ANY failure —
 * callers treat the mirror as best-effort. */
export async function gdriveUpload(
  filename: string,
  contentType: string,
  bytes: Buffer,
): Promise<DriveUploadResult | null> {
  const folderId = process.env.GDRIVE_APPROVALS_FOLDER_ID
  if (!folderId) return null
  const token = await getAccessToken()
  if (!token) return null

  // multipart/related upload: JSON metadata part + binary content part.
  const boundary = `tidelog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const metadata = JSON.stringify({ name: filename, parents: [folderId] })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ])

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
        signal: controller.signal,
      },
    )
    const result = await res.json() as { id?: string; webViewLink?: string; error?: { message?: string } }
    if (!res.ok || !result.id) {
      console.error('[gdrive] upload failed:', result.error?.message ?? res.status)
      return null
    }
    return { id: result.id, webViewLink: result.webViewLink ?? null }
  } catch (err) {
    console.error('[gdrive] upload error:', (err as Error).message)
    return null
  } finally {
    clearTimeout(timer)
  }
}
