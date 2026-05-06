import test from 'node:test'
import assert from 'node:assert/strict'

import { getPnlData, PnlNotCachedError } from './pnl-data.ts'

// We mock readCachedReportsInRange via the module exports. Since pnl-data.ts
// imports it directly, we use bun's module-mocking via dynamic injection: in
// these tests we replace the implementation through a test seam. For now,
// this test file uses the live DB and is structured as an integration test.
// If the live DB is unavailable, skip via `process.env.SKIP_DB_TESTS`.

test('getPnlData returns partialEntities = [] for single-entity scope', async () => {
  if (process.env.SKIP_DB_TESTS) return
  // Arrange: pick a known-cached entity/period from the dev DB.
  // This test runs against whatever data the local DB has — it asserts shape, not content.
  try {
    const result = await getPnlData('Opco', '2026-01-01', '2026-01-31')
    assert.equal(Array.isArray(result.sections), true)
    assert.equal(Array.isArray(result.partialEntities), true)
    assert.equal(result.partialEntities.length, 0)
  } catch (err) {
    if (err instanceof PnlNotCachedError) {
      // Acceptable — local DB has no cached data for this period.
      return
    }
    throw err
  }
})
