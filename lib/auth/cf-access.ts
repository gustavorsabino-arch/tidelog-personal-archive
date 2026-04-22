import { jwtVerify, createLocalJWKSet, type JWTPayload } from 'jose'

export type CfClaims = JWTPayload & {
  email: string
  identity_nonce?: string
  sub?: string
}

type VerifyOptions = {
  aud: string
  issuer: string
  jwks: () => Promise<{ keys: any[] }>
}

export async function verifyCfJwt(token: string, opts: VerifyOptions): Promise<CfClaims> {
  const jwks = await opts.jwks()
  const keySet = createLocalJWKSet(jwks as any)

  const { payload } = await jwtVerify(token, keySet, {
    audience: opts.aud,
    issuer: opts.issuer,
  })

  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw new Error('CF JWT missing email claim')
  }

  return payload as CfClaims
}

// Production JWKS fetcher with in-memory cache (5 min TTL)
let cachedJwks: { fetchedAt: number; data: { keys: any[] } } | null = null

export async function fetchCfJwks(teamDomain: string): Promise<{ keys: any[] }> {
  const now = Date.now()
  if (cachedJwks && now - cachedJwks.fetchedAt < 5 * 60 * 1000) {
    return cachedJwks.data
  }
  const url = `https://${teamDomain}/cdn-cgi/access/certs`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CF JWKS fetch failed: ${res.status} ${res.statusText}`)
  const data = await res.json() as { keys: any[] }
  cachedJwks = { fetchedAt: now, data }
  return data
}
