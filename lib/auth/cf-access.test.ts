import { test, expect, beforeAll } from 'bun:test'
import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import { verifyCfJwt } from './cf-access'

let privateKey: CryptoKey
let publicJwk: any
const AUD = 'test-aud-123'
const ISSUER = 'https://test.cloudflareaccess.com'
const KID = 'test-kid'

beforeAll(async () => {
  const keys = await generateKeyPair('RS256')
  privateKey = keys.privateKey
  publicJwk = await exportJWK(keys.publicKey)
  publicJwk.kid = KID
  publicJwk.alg = 'RS256'
})

async function signToken(overrides: Record<string, unknown> = {}) {
  const builder = new SignJWT({ email: 'user@orca.so', ...(overrides.payload as object ?? {}) })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer((overrides.iss as string) ?? ISSUER)
    .setAudience((overrides.aud as string) ?? AUD)
    .setIssuedAt()

  if ('exp' in overrides) {
    builder.setExpirationTime(overrides.exp as number)
  } else {
    builder.setExpirationTime('10m')
  }

  return builder.sign(privateKey)
}

const fakeJwks = async () => ({ keys: [publicJwk] })

test('verifyCfJwt accepts valid token', async () => {
  const token = await signToken()
  const claims = await verifyCfJwt(token, { aud: AUD, issuer: ISSUER, jwks: fakeJwks })
  expect(claims.email).toBe('user@orca.so')
})

test('verifyCfJwt rejects wrong aud', async () => {
  const token = await signToken({ aud: 'wrong-aud' })
  await expect(
    verifyCfJwt(token, { aud: AUD, issuer: ISSUER, jwks: fakeJwks })
  ).rejects.toThrow()
})

test('verifyCfJwt rejects wrong issuer', async () => {
  const token = await signToken({ iss: 'https://evil.example.com' })
  await expect(
    verifyCfJwt(token, { aud: AUD, issuer: ISSUER, jwks: fakeJwks })
  ).rejects.toThrow()
})

test('verifyCfJwt rejects expired token', async () => {
  const token = await signToken({ exp: Math.floor(Date.now() / 1000) - 10 })
  await expect(
    verifyCfJwt(token, { aud: AUD, issuer: ISSUER, jwks: fakeJwks })
  ).rejects.toThrow()
})

test('verifyCfJwt rejects tampered signature', async () => {
  const token = await signToken()
  const tampered = token.slice(0, -5) + 'AAAAA'
  await expect(
    verifyCfJwt(tampered, { aud: AUD, issuer: ISSUER, jwks: fakeJwks })
  ).rejects.toThrow()
})

test('verifyCfJwt rejects missing email claim', async () => {
  const noEmailToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(AUD)
    .setExpirationTime('10m')
    .setIssuedAt()
    .sign(privateKey)
  await expect(
    verifyCfJwt(noEmailToken, { aud: AUD, issuer: ISSUER, jwks: fakeJwks })
  ).rejects.toThrow(/email/)
})

test('verifyCfJwt rejects empty email claim', async () => {
  const emptyEmailToken = await signToken({ payload: { email: '' } })
  await expect(
    verifyCfJwt(emptyEmailToken, { aud: AUD, issuer: ISSUER, jwks: fakeJwks })
  ).rejects.toThrow(/email/)
})

