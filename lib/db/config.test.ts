import { test, expect } from 'bun:test'
import { resolveDbConfig } from './config'

test('DB_MODE=local returns { mode: "local", url }', () => {
  const config = resolveDbConfig({ DB_MODE: 'local', DATABASE_URL: 'postgres://x:y@localhost:5432/z' })
  expect(config).toEqual({ mode: 'local', url: 'postgres://x:y@localhost:5432/z' })
})

test('DB_MODE=local without DATABASE_URL throws', () => {
  expect(() => resolveDbConfig({ DB_MODE: 'local' })).toThrow(/DATABASE_URL/)
})

test('DB_MODE=aws returns aws config with defaults', () => {
  const config = resolveDbConfig({
    DB_MODE: 'aws',
    DB_HOST: 'rds.example.com',
    DB_NAME: 'tidelog',
    DB_USER: 'tidelog_app',
    AWS_REGION: 'us-east-1',
  })
  expect(config).toEqual({
    mode: 'aws',
    host: 'rds.example.com',
    port: 5432,
    database: 'tidelog',
    username: 'tidelog_app',
    region: 'us-east-1',
  })
})

test('DB_MODE=aws honors DB_PORT override', () => {
  const config = resolveDbConfig({
    DB_MODE: 'aws',
    DB_HOST: 'rds.example.com',
    DB_PORT: '6543',
    DB_NAME: 'tidelog',
    DB_USER: 'tidelog_app',
    AWS_REGION: 'us-east-1',
  })
  expect(config.mode === 'aws' && config.port).toBe(6543)
})

test('DB_MODE=aws missing single var throws and names it', () => {
  expect(() => resolveDbConfig({
    DB_MODE: 'aws',
    DB_NAME: 'tidelog',
    DB_USER: 'tidelog_app',
    AWS_REGION: 'us-east-1',
  })).toThrow(/DB_HOST/)
})

test('DB_MODE=aws missing multiple vars lists all in error', () => {
  try {
    resolveDbConfig({ DB_MODE: 'aws' })
    throw new Error('should have thrown')
  } catch (e) {
    const msg = (e as Error).message
    expect(msg).toContain('DB_HOST')
    expect(msg).toContain('DB_NAME')
    expect(msg).toContain('DB_USER')
    expect(msg).toContain('AWS_REGION')
  }
})

test('DB_MODE unset throws', () => {
  expect(() => resolveDbConfig({})).toThrow(/DB_MODE/)
})

test('DB_MODE=invalid throws', () => {
  expect(() => resolveDbConfig({ DB_MODE: 'prod' })).toThrow(/DB_MODE/)
})
