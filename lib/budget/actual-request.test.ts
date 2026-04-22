import test from 'node:test'
import assert from 'node:assert/strict'

import { getBudgetActualRequest } from './actual-request.ts'

test('returns overview actual requests for the full overview tab', () => {
  const request = getBudgetActualRequest({
    activeDepartment: '',
    activeTab: 'overview',
    departmentCacheKey: null,
    headcountCacheKey: '2026:All:ytd:1:0:1',
    overviewCacheKey: '2026:All:ytd:1:0:1',
    overviewDepartment: null,
  })

  assert.deepEqual(request, {
    kind: 'overview',
    cacheKey: '2026:All:ytd:1:0:1',
    requestKey: 'overview:2026:All:ytd:1:0:1',
  })
})

test('returns department actual requests for scoped overview users', () => {
  const request = getBudgetActualRequest({
    activeDepartment: 'Engineering',
    activeTab: 'overview',
    departmentCacheKey: '2026:All:ytd:1:0:1:Engineering',
    headcountCacheKey: '2026:All:ytd:1:0:1',
    overviewCacheKey: '2026:All:ytd:1:0:1',
    overviewDepartment: 'Engineering',
  })

  assert.deepEqual(request, {
    kind: 'department',
    cacheKey: '2026:All:ytd:1:0:1:Engineering',
    requestKey: 'department:2026:All:ytd:1:0:1:Engineering',
    department: 'Engineering',
  })
})

test('returns headcount actual requests for the headcount tab', () => {
  const request = getBudgetActualRequest({
    activeDepartment: '',
    activeTab: 'headcount',
    departmentCacheKey: null,
    headcountCacheKey: '2026:Opco:month:1:0:1',
    overviewCacheKey: '2026:Opco:month:1:0:1',
    overviewDepartment: null,
  })

  assert.deepEqual(request, {
    kind: 'headcount',
    cacheKey: '2026:Opco:month:1:0:1',
    requestKey: 'headcount:2026:Opco:month:1:0:1',
  })
})

test('returns null when the active tab does not use report actuals', () => {
  const request = getBudgetActualRequest({
    activeDepartment: '',
    activeTab: 'coverage',
    departmentCacheKey: null,
    headcountCacheKey: '2026:All:ytd:1:0:1',
    overviewCacheKey: '2026:All:ytd:1:0:1',
    overviewDepartment: null,
  })

  assert.equal(request, null)
})
