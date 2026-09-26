import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

import {
  BUDGET_ADJUSTMENT_TABLE_DDL,
  createEnsureBudgetAdjustmentTable,
} from './budget-adjustment-schema'

const dialect = new PgDialect()
const toText = (query: SQL) => dialect.sqlToQuery(query).sql

function recordingExecutor(probeResults: unknown[][]) {
  const calls: string[] = []
  let probeIndex = 0
  const execute = async (query: SQL) => {
    const text = toText(query)
    calls.push(text)
    if (text.includes('information_schema.tables')) return probeResults[probeIndex++] ?? []
    return []
  }
  return { execute, calls }
}

// Migration files are committed with mixed line endings (CRLF / BOM), so compare content only.
const normalize = (text: string) => text.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim()

test('DDL matches migration 0032 exactly', () => {
  const migration = readFileSync(
    join(import.meta.dir, 'migrations', '0032_budget_adjustment.sql'),
    'utf-8',
  )
  expect(normalize(BUDGET_ADJUSTMENT_TABLE_DDL)).toBe(normalize(migration))
})

test('creates the table when the probe finds it missing', async () => {
  const { execute, calls } = recordingExecutor([[]])
  await createEnsureBudgetAdjustmentTable(execute)()
  expect(calls).toHaveLength(2)
  expect(calls[1]).toContain('CREATE TABLE IF NOT EXISTS "app"."budget_adjustment"')
})

test('skips DDL when the table already exists', async () => {
  const { execute, calls } = recordingExecutor([[{ '?column?': 1 }]])
  await createEnsureBudgetAdjustmentTable(execute)()
  expect(calls).toHaveLength(1)
})

test('memoizes a successful check per instance', async () => {
  const { execute, calls } = recordingExecutor([[{ '?column?': 1 }]])
  const ensure = createEnsureBudgetAdjustmentTable(execute)
  await ensure()
  await ensure()
  expect(calls).toHaveLength(1)
})

test('treats a concurrent-create duplicate error as success', async () => {
  const ensure = createEnsureBudgetAdjustmentTable(async (query) => {
    if (toText(query).includes('information_schema.tables')) return []
    throw new Error('duplicate key value violates unique constraint "pg_type_typname_nsp_index"')
  })
  await expect(ensure()).resolves.toBeUndefined()
})

test('still surfaces other CREATE failures', async () => {
  const ensure = createEnsureBudgetAdjustmentTable(async (query) => {
    if (toText(query).includes('information_schema.tables')) return []
    throw new Error('permission denied for schema app')
  })
  await expect(ensure()).rejects.toThrow('permission denied')
})

test('does not cache a failure — the next call retries', async () => {
  let attempt = 0
  const calls: string[] = []
  const ensure = createEnsureBudgetAdjustmentTable(async (query) => {
    calls.push(toText(query))
    attempt += 1
    if (attempt === 1) throw new Error('connection reset')
    return [{ '?column?': 1 }]
  })
  await expect(ensure()).rejects.toThrow('connection reset')
  await ensure()
  expect(calls).toHaveLength(2)
})
