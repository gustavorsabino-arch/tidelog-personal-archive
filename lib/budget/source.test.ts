import test from 'node:test'
import assert from 'node:assert/strict'

import { getBudgetDepartmentsToRead } from './source.ts'

test('only includes requested departments that have plan files present', () => {
  const departments = getBudgetDepartmentsToRead(
    2026,
    ['Engineering'],
    ['engineering.json', 'marketing.json'],
  )

  assert.deepEqual(departments, ['Engineering'])
})

test('skips departments whose plan files are missing from the listed directory contents', () => {
  const departments = getBudgetDepartmentsToRead(
    2026,
    null,
    ['engineering.json'],
  )

  assert.deepEqual(departments, ['Engineering'])
})
