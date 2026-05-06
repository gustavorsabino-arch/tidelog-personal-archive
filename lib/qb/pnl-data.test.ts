import test from 'node:test'
import assert from 'node:assert/strict'

import { getPnlData, PnlNotCachedError } from './pnl-data.ts'

// Integration test against the live DB; pure-merge logic is covered separately
// in pnl-combine.test.ts. Set `SKIP_DB_TESTS=1` to skip — but note that loading
// pnl-data.ts transitively imports lib/db, so DB_MODE/DATABASE_URL must still
// be defined in the environment for this file to even import.

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
