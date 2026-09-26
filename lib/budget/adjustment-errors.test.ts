import { test, expect } from 'bun:test'

import { budgetAdjustmentErrorResponse } from './adjustment-errors'

test('missing table maps to 503 with a setup hint', async () => {
  const res = budgetAdjustmentErrorResponse(
    new Error('relation "app.budget_adjustment" does not exist'),
    'load',
  )
  expect(res.status).toBe(503)
  expect((await res.json()).error).toContain('not set up yet')
})

test('other failures map to 500 naming the action', async () => {
  const res = budgetAdjustmentErrorResponse(new Error('connection reset'), 'reverse')
  expect(res.status).toBe(500)
  expect((await res.json()).error).toBe('Failed to reverse adjustment: connection reset')
})
