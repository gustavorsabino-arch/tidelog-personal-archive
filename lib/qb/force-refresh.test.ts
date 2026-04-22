import { test, expect } from 'bun:test'
import { FORCE_REFRESH_HISTORY_START, parseFromPeriod } from './force-refresh'

test('accepts HISTORY_START boundary', () => {
  const res = parseFromPeriod(FORCE_REFRESH_HISTORY_START)
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.value).toBe(FORCE_REFRESH_HISTORY_START)
})

test('accepts month inside range', () => {
  const res = parseFromPeriod('2026-04')
  expect(res.ok).toBe(true)
})

test('rejects non-string', () => {
  const res = parseFromPeriod(2026)
  expect(res.ok).toBe(false)
})

test('rejects undefined', () => {
  const res = parseFromPeriod(undefined)
  expect(res.ok).toBe(false)
})

test('rejects wrong shape (single-digit month)', () => {
  const res = parseFromPeriod('2026-4')
  expect(res.ok).toBe(false)
})

test('rejects wrong shape (extra chars)', () => {
  const res = parseFromPeriod('2026-04-01')
  expect(res.ok).toBe(false)
})

test('rejects month = 00', () => {
  const res = parseFromPeriod('2026-00')
  expect(res.ok).toBe(false)
})

test('rejects month = 13', () => {
  const res = parseFromPeriod('2026-13')
  expect(res.ok).toBe(false)
})

test('rejects year before HISTORY_START', () => {
  const res = parseFromPeriod('2025-12')
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toContain(FORCE_REFRESH_HISTORY_START)
})
