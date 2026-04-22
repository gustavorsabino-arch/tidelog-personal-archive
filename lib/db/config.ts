export type DbConfig =
  | { mode: 'local'; url: string }
  | {
      mode: 'aws'
      host: string
      port: number
      database: string
      username: string
      region: string
    }

export function resolveDbConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): DbConfig {
  const mode = env.DB_MODE

  if (mode === 'local') {
    if (!env.DATABASE_URL) {
      throw new Error('DB_MODE=local requires DATABASE_URL')
    }
    return { mode: 'local', url: env.DATABASE_URL }
  }

  if (mode === 'aws') {
    const missing: string[] = []
    if (!env.DB_HOST) missing.push('DB_HOST')
    if (!env.DB_NAME) missing.push('DB_NAME')
    if (!env.DB_USER) missing.push('DB_USER')
    if (!env.AWS_REGION) missing.push('AWS_REGION')
    if (missing.length > 0) {
      throw new Error(`DB_MODE=aws requires: ${missing.join(', ')}`)
    }
    return {
      mode: 'aws',
      host: env.DB_HOST!,
      port: Number(env.DB_PORT ?? 5432),
      database: env.DB_NAME!,
      username: env.DB_USER!,
      region: env.AWS_REGION!,
    }
  }

  throw new Error(`DB_MODE must be 'local' or 'aws' (got: ${mode ?? 'unset'})`)
}
