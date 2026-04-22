import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { Signer } from '@aws-sdk/rds-signer'
import * as schema from './schema'
import { resolveDbConfig } from './config'

const config = resolveDbConfig(process.env)

let client: ReturnType<typeof postgres>
if (config.mode === 'local') {
  client = postgres(config.url, { max: 10, idle_timeout: 20 })
} else {
  const signer = new Signer({
    hostname: config.host,
    port: config.port,
    username: config.username,
    region: config.region,
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
