import { createQboOAuthState, isQboOAuthStateFresh, parseQboOAuthState } from './oauth.ts'
import { QBO_AUTH_URL, QBO_BASE_URL, QBO_SCOPE, QBO_TOKEN_URL, getQboRealmId, type QboEntity } from './config.ts'
import { computeQboExpiresAt, isQboExpiringSoon } from './tokens.ts'
import { getQboConnectionByEntity, upsertQboConnection } from './store.ts'
import type { QboConnection, QboOAuthStatePayload } from './types.ts'

type QboTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

const QBO_MAX_RETRIES = 3

export class QboHttpError extends Error {
  readonly status: number
  readonly intuitTid: string | null
  readonly responseText: string
  constructor(status: number, message: string, intuitTid: string | null, responseText: string) {
    super(message)
    this.name = 'QboHttpError'
    this.status = status
    this.intuitTid = intuitTid
    this.responseText = responseText
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getQboEnv() {
  const clientId = process.env.QB_CLIENT_ID || ''
  const clientSecret = process.env.QB_CLIENT_SECRET || ''
  const redirectUri = process.env.QB_REDIRECT_URI || ''
  const stateSecret = process.env.QB_OAUTH_STATE_SECRET || clientSecret

  if (!clientId || !clientSecret || !redirectUri || !stateSecret) {
    throw new Error('QuickBooks OAuth is not configured. Set QB_CLIENT_ID, QB_CLIENT_SECRET, and QB_REDIRECT_URI.')
  }

  return { clientId, clientSecret, redirectUri, stateSecret }
}

function getFrontendOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
}

async function requestQboTokens(body: URLSearchParams): Promise<QboTokenResponse> {
  const { clientId, clientSecret } = getQboEnv()
  const tokenRes = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      Accept: 'application/json',
    },
    body,
    // A hung token endpoint must not pin the function (and, on the posting
    // path, the DB advisory lock) until maxDuration kills it.
    signal: AbortSignal.timeout(20_000),
  })

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text()
    throw new Error(`QuickBooks token exchange failed (${tokenRes.status}): ${errorText}`)
  }

  return tokenRes.json() as Promise<QboTokenResponse>
}

async function requestQboJson<T>(
  connection: QboConnection,
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: string },
): Promise<Response> {
  return fetch(`${QBO_BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body,
    cache: 'no-store',
    // Big GL reports are slow but bounded; a blackholed connection is not.
    // Post-batch holds a pg advisory lock across this call, so it must fail
    // in bounded time rather than ride to the function's maxDuration.
    signal: AbortSignal.timeout(60_000),
  })
}

function getRetryDelayMs(response: Response, attempt: number): number {
  // Honor Retry-After but never sleep unbounded — QB may send large values,
  // and on the posting path this sleep happens while holding the advisory
  // lock inside an open transaction.
  const MAX_RETRY_DELAY_MS = 10_000
  const retryAfterSeconds = Number.parseFloat(response.headers.get('retry-after') ?? '')
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS)
  }

  return Math.min(600 * 2 ** attempt, MAX_RETRY_DELAY_MS)
}

export function createQboConnectUrl(entity: QboEntity, email: string): string {
  const { clientId, redirectUri, stateSecret } = getQboEnv()
  const realmId = getQboRealmId(entity)
  const state = createQboOAuthState({ entity, realmId, email: email.trim().toLowerCase() }, stateSecret)

  const params = new URLSearchParams({
    client_id: clientId,
    scope: QBO_SCOPE,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  })

  return `${QBO_AUTH_URL}?${params.toString()}`
}

export function parseAndValidateQboCallbackState(state: string): QboOAuthStatePayload {
  const { stateSecret } = getQboEnv()
  const payload = parseQboOAuthState(state, stateSecret)
  if (!payload || !isQboOAuthStateFresh(payload)) {
    throw new Error('Invalid or expired QBO OAuth state')
  }
  return payload
}

export async function exchangeQboAuthorizationCode(
  code: string,
  payload: QboOAuthStatePayload,
  callbackRealmId?: string | null,
): Promise<QboConnection> {
  const { redirectUri } = getQboEnv()
  const tokens = await requestQboTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  )

  const realmId = callbackRealmId || payload.realmId
  if (realmId !== payload.realmId) {
    throw new Error('QuickBooks callback realm did not match the requested company')
  }
  if (!tokens.refresh_token) {
    throw new Error('QuickBooks did not return a refresh token')
  }

  return upsertQboConnection({
    entity: payload.entity,
    realmId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: computeQboExpiresAt(tokens.expires_in || 3600),
    connectedBy: payload.email ?? null,
  })
}

export async function refreshQboConnection(entity: QboEntity): Promise<QboConnection> {
  const { redirectUri } = getQboEnv()
  const current = await getQboConnectionByEntity(entity)
  if (!current?.refreshToken) {
    throw new Error(`No QBO refresh token available for ${entity}`)
  }

  const tokens = await requestQboTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      redirect_uri: redirectUri,
    }),
  )

  return upsertQboConnection({
    entity,
    realmId: current.realmId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || current.refreshToken,
    expiresAt: computeQboExpiresAt(tokens.expires_in || 3600),
    connectedBy: current.connectedBy,
  })
}

export async function ensureQboConnection(entity: QboEntity): Promise<QboConnection> {
  const current = await getQboConnectionByEntity(entity)
  if (!current) {
    throw new Error(`QuickBooks is not connected for ${entity}`)
  }

  if (isQboExpiringSoon(current.expiresAt)) {
    return refreshQboConnection(entity)
  }

  return current
}

export async function fetchQboJson<T>(
  entity: QboEntity,
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: string },
): Promise<T> {
  let connection = await ensureQboConnection(entity)
  let response: Response | null = null

  for (let attempt = 0; attempt <= QBO_MAX_RETRIES; attempt += 1) {
    response = await requestQboJson<T>(connection, path, init)

    if (response.status === 401 && attempt < QBO_MAX_RETRIES) {
      connection = await refreshQboConnection(entity)
      continue
    }

    if (response.status === 429 && attempt < QBO_MAX_RETRIES) {
      await sleep(getRetryDelayMs(response, attempt))
      continue
    }

    break
  }

  if (!response?.ok) {
    const errorText = await response?.text().catch(() => '') ?? ''
    const intuitTid = response?.headers.get('intuit_tid') ?? null
    const tidSuffix = intuitTid ? ` [intuit_tid=${intuitTid}]` : ''
    const status = response?.status ?? 0
    throw new QboHttpError(
      status,
      `QuickBooks request failed for ${entity} (${status || 'unknown'})${tidSuffix}: ${errorText}`,
      intuitTid,
      errorText,
    )
  }

  return response.json() as Promise<T>
}

export type QbReportType = 'balance_sheet' | 'profit_and_loss' | 'general_ledger'

const REPORT_PATHS: Record<QbReportType, string> = {
  balance_sheet: 'BalanceSheet',
  profit_and_loss: 'ProfitAndLoss',
  general_ledger: 'GeneralLedger',
}

/**
 * Fetch a QuickBooks report for the given entity + parameters.
 * Returns the raw QB response JSON; cron upserts this into qb_report_cache.
 */
export async function qbFetchReport(
  entity: QboEntity,
  reportType: QbReportType,
  params: Record<string, string>,
): Promise<unknown> {
  const realmId = getQboRealmId(entity)
  const defaults: Record<string, string> = {
    accounting_method: 'Accrual',
    minorversion: '65',
  }
  // We intentionally do NOT pass a `columns` parameter for GL. QB's `columns=`
  // query uses a different vocabulary than the response metadata: column
  // names that appear in QB's own response `Columns` array (e.g.
  // `subt_nat_home_amount`) are silently dropped when sent as a request,
  // because the request-side accepts different keywords we couldn't
  // empirically determine. Letting QB return its default column set works
  // for every realm, and the parser (`lib/budget/qb-general-ledger.ts`)
  // identifies fields by the response-side `ColKey` metadata rather than by
  // position, so it handles whatever QB chooses to return.
  // Strip our internal `accountNumber` helper from the request — it's a cache
  // key, not a QB param, and QB ignores unknown params but it's noisy.
  const { accountNumber: _unused, ...qbParams } = params as { accountNumber?: string }
  const qs = new URLSearchParams({
    ...defaults,
    ...qbParams,
  }).toString()
  const path = `/v3/company/${realmId}/reports/${REPORT_PATHS[reportType]}?${qs}`
  return fetchQboJson<unknown>(entity, path)
}

export function getQboCallbackSuccessHtml(entity: QboEntity, realmId: string) {
  const safeEntity = entity.replace(/[^a-zA-Z0-9 ]/g, '')
  const safeRealmId = realmId.replace(/[^a-zA-Z0-9]/g, '')
  const origin = getFrontendOrigin()

  return `<!DOCTYPE html>
<html><head><title>Connected!</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#06D6A0}</style>
</head><body>
  <div style="text-align:center">
    <div style="font-size:2rem;margin-bottom:8px">&#10003;</div>
    <div style="font-size:1rem">QuickBooks connected for <strong>${safeEntity}</strong></div>
    <div style="font-size:0.75rem;color:#888;margin-top:8px">This window will close automatically…</div>
  </div>
  <script>
    if(window.opener) {
      window.opener.postMessage({ type: 'QB_AUTH_SUCCESS', realmId: '${safeRealmId}', entity: '${safeEntity}' }, '${origin}');
    }
    setTimeout(() => window.close(), 1500);
  </script>
</body></html>`
}
