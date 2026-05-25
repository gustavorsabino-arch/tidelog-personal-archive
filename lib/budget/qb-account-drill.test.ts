import test from 'node:test'
import assert from 'node:assert/strict'

import { synthesizeAccountDrillTasks } from './qb-account-drill.ts'
import type { BudgetViewState } from './types.ts'

const VIEW: BudgetViewState = {
  year: 2026,
  entity: 'All',
  mode: 'ytd',
  month: 3,
  rangeStart: 0,
  rangeEnd: 2,
}

test('expands a single account drill into one task per configured entity when entity is All', () => {
  const tasks = synthesizeAccountDrillTasks(VIEW, '61010')
  const entities = tasks.map((task) => task.entity).sort()
  assert.deepEqual(entities, ['Foundation', 'Opco', 'Zagreus'])
  for (const task of tasks) {
    assert.equal(task.accountNumber, '61010')
  }
})

test('limits to a single entity when the view is scoped to one', () => {
  const tasks = synthesizeAccountDrillTasks({ ...VIEW, entity: 'Opco' }, '61010')
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0]?.entity, 'Opco')
  assert.equal(tasks[0]?.accountNumber, '61010')
})

test('rejects an account number that is not a numeric token', () => {
  assert.throws(() => synthesizeAccountDrillTasks(VIEW, ''), /accountNumber/)
  assert.throws(() => synthesizeAccountDrillTasks(VIEW, 'abc'), /accountNumber/)
})
