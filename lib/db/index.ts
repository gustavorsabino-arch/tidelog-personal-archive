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

  client = postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: () => signer.getAuthToken(),
    ssl: 'require',
    max: 10,
    idle_timeout: 20,
  })
}

export const db = drizzle(client, { schema })
export type Db = typeof db
