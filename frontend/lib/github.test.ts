import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getDataDirectoryCacheTag,
  getDataFileCacheTag,
  getDataPathRevalidationTags,
} from './github.ts'

test('builds stable cache tags for data files and directories', () => {
  assert.equal(
    getDataFileCacheTag('/budget/2026/plan/engineering.json'),
    'github-data:file:budget/2026/plan/engineering.json',
  )
  assert.equal(
    getDataDirectoryCacheTag('budget/2026/plan'),
    'github-data:dir:budget/2026/plan',
  )
})

test('includes the file and every ancestor directory when invalidating a data path', () => {
  assert.deepEqual(
    getDataPathRevalidationTags('budget/2026/plan/engineering.json'),
    [
      'github-data:file:budget/2026/plan/engineering.json',
      'github-data:dir:budget',
      'github-data:dir:budget/2026',
      'github-data:dir:budget/2026/plan',
    ],
  )
})
