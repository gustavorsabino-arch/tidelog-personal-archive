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
  let cachedToken: { value: string; expiresAt: number } | null = null
  const getAuthToken = async () => {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
    const value = await signer.getAuthToken()
    cachedToken = { value, expiresAt: Date.now() + TOKEN_TTL_MS }
    return value
  }

  client = postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: getAuthToken,
    ssl: 'require',
    // Sized for Vercel serverless against a small RDS instance
    // (max_connections=79). Each invocation runs in its own function instance;
    // a 10-deep pool × N instances trivially overshoots the server cap under
    // burst traffic, producing FATAL 53300 ("too many connections") errors
    // across every endpoint. 3 per instance + a 60s idle timeout lets bursts
    // of cron + user traffic coexist; the cached IAM token (above) keeps
    // re-handshakes cheap when a connection has to be re-opened.
    max: 3,
    idle_timeout: 60,
  })
}

export const db = drizzle(client, { schema })
export type Db = typeof db
