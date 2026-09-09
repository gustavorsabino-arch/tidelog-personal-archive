import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { Signer } from '@aws-sdk/rds-signer'
import { awsCredentialsProvider } from '@vercel/functions/oidc'
import * as schema from './schema'
import { resolveDbConfig } from './config'

const config = resolveDbConfig(process.env)

let client: ReturnType<typeof postgres>
if (config.mode === 'local') {
  client = postgres(config.url, { max: 10, idle_timeout: 20 })
} else {
  // Vercel injects VERCEL_OIDC_TOKEN per-request (not at module load), so the
  // Signer must be built inside the password callback where the token is
  // guaranteed to be present.
  const roleArn = process.env.AWS_ROLE_ARN
  if (!roleArn) {
    throw new Error('DB_MODE=aws requires AWS_ROLE_ARN env var')
  }

  // @vercel/functions/oidc pulls the OIDC token from the request header
  // (x-vercel-oidc-token) or process.env, whichever is populated, and handles
  // the STS AssumeRoleWithWebIdentity exchange.
  const credentials = awsCredentialsProvider({ roleArn })

  const signer = new Signer({
    hostname: config.host,
    port: config.port,
    username: config.username,
    region: config.region,
    credentials,
  })

  // Cache the IAM auth token at module scope so reconnects within a token's
  // lifetime don't re-sign. RDS IAM tokens are valid for 15 min; we refresh
  // 1 min early to give in-flight connection attempts a safe margin.
  const TOKEN_TTL_MS = 14 * 60 * 1000
  // Negative-cache STS failures briefly so a thundering herd of requests
  // during an OIDC/AWS outage doesn't hammer STS — every caller fails fast
  // off the cached error instead of waiting 5s for its own timeout.
  const NEG_CACHE_MS = 5 * 1000
  // Cap how long we'll wait on STS+RDS signing. STS in steady state takes
  // <500ms; if it's hanging or returning slow errors, we'd rather fail the
  // request than tie up the serverless function for its full timeout.
  const AUTH_TIMEOUT_MS = 5 * 1000
  let cachedToken: { value: string; expiresAt: number } | null = null
  let cachedError: { error: Error; expiresAt: number } | null = null
  const getAuthToken = async () => {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
    if (cachedError && cachedError.expiresAt > Date.now()) throw cachedError.error
    try {
      const value = await Promise.race([
        signer.getAuthToken(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`RDS IAM auth token request timed out after ${AUTH_TIMEOUT_MS}ms`)),
            AUTH_TIMEOUT_MS,
          ),
        ),
      ])
      cachedToken = { value, expiresAt: Date.now() + TOKEN_TTL_MS }
      cachedError = null
      return value
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      console.error('[db] RDS IAM auth token failed', {
        error: err.message,
        name: err.name,
      })
      cachedError = { error: err, expiresAt: Date.now() + NEG_CACHE_MS }
      throw err
    }
  }

  client = postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: getAuthToken,
    ssl: 'require',
    // Sized for Vercel serverless against a small RDS instance
    // (max_connections=79). 6 per instance × ~6 concurrent instances under
    // burst leaves ~43 connections free for user traffic; still bounded well
    // under the 79 cap that previously produced FATAL 53300 ("too many
    // connections") cascades when set to 10.
    max: 6,
    idle_timeout: 60,
    // Bound how long we'll wait to establish a connection. Default is 30s
    // which is long enough that a broken DB (e.g. AWS OIDC misconfig, RDS
    // unavailable) makes login requests appear to hang indefinitely.
    connect_timeout: 10,
  })
}

export const db = drizzle(client, { schema })
export type Db = typeof db
