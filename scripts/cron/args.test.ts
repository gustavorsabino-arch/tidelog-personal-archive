import { test, expect } from 'bun:test'
import { CRON_HISTORY_START, looksLikeProd, parseCronArgs } from './args'

function parse(args: string[]) {
  return parseCronArgs(['bun', 'run.ts', ...args])
}

test('parses bare job name', () => {
  const res = parse(['fetch-qb-reports'])
  expect(res).toEqual({
    ok: true,
    name: 'fetch-qb-reports',
    full: false,
    force: false,
    forceFrom: null,
    walletAddr: null,
  })
})

test('parses --wallet=<addr>', () => {
  const addr = 'HnfkTtEG1ZEfyv3bkXeHu1J7ef2DzuDmQ99DDbQs8jg1'
  const res = parse(['fetch-transactions', `--wallet=${addr}`])
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.walletAddr).toBe(addr)
})

test('parses --full --wallet=<addr> together', () => {
  const addr = 'HnfkTtEG1ZEfyv3bkXeHu1J7ef2DzuDmQ99DDbQs8jg1'
  const res = parse(['fetch-transactions', '--full', `--wallet=${addr}`])
  expect(res.ok).toBe(true)
  if (res.ok) {
    expect(res.full).toBe(true)
    expect(res.walletAddr).toBe(addr)
  }
})

test('rejects malformed --wallet (too short)', () => {
  const res = parse(['fetch-transactions', '--wallet=tooShort'])
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toContain('--wallet')
})

test('rejects malformed --wallet (contains 0/O/I/l ambiguous chars)', () => {
  const res = parse(['fetch-transactions', '--wallet=0OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO'])
  expect(res.ok).toBe(false)
})

test('rejects empty --wallet=', () => {
  const res = parse(['fetch-transactions', '--wallet='])
  expect(res.ok).toBe(false)
})

test('parses --full', () => {
  const res = parse(['fetch-transactions', '--full'])
  expect(res.ok).toBe(true)
  if (res.ok) expect(res.full).toBe(true)
})

test('parses --force without --from', () => {
  const res = parse(['fetch-qb-reports', '--force'])
  expect(res.ok).toBe(true)
  if (res.ok) {
    expect(res.force).toBe(true)
    expect(res.forceFrom).toBeNull()
  }
})

test('parses --force --from=2026-03', () => {
  const res = parse(['fetch-qb-reports', '--force', '--from=2026-03'])
  expect(res.ok).toBe(true)
  if (res.ok) {
    expect(res.force).toBe(true)
    expect(res.forceFrom).toBe('2026-03')
  }
})

test(`accepts --from=${CRON_HISTORY_START} (HISTORY_START boundary)`, () => {
  const res = parse(['fetch-qb-reports', '--force', `--from=${CRON_HISTORY_START}`])
  expect(res.ok).toBe(true)
})

test('rejects --from without --force', () => {
  const res = parse(['fetch-qb-reports', '--from=2026-03'])
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toContain('--from requires --force')
})

test('rejects malformed --from (single-digit month)', () => {
  const res = parse(['fetch-qb-reports', '--force', '--from=2026-3'])
  expect(res.ok).toBe(false)
})

test('rejects --from before HISTORY_START', () => {
  const res = parse(['fetch-qb-reports', '--force', '--from=2018-12'])
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toContain(`>= ${CRON_HISTORY_START}`)
})

test('rejects month > 12', () => {
  const res = parse(['fetch-qb-reports', '--force', '--from=2026-13'])
  expect(res.ok).toBe(false)
})

test('rejects month == 00', () => {
  const res = parse(['fetch-qb-reports', '--force', '--from=2026-00'])
  expect(res.ok).toBe(false)
})

test('rejects missing job name', () => {
  const res = parse([])
  expect(res.ok).toBe(false)
})

test('rejects flag-shaped job name', () => {
  const res = parse(['--force'])
  expect(res.ok).toBe(false)
})

test('looksLikeProd: false for localhost', () => {
  expect(looksLikeProd('postgres://postgres:postgres@localhost:54322/postgres')).toBe(false)
})

test('looksLikeProd: false for 127.0.0.1', () => {
  expect(looksLikeProd('postgres://postgres:postgres@127.0.0.1:54322/postgres')).toBe(false)
})

test('looksLikeProd: true for RDS hostname', () => {
  expect(
    looksLikeProd(
      'postgres://tidelog@tidelog-db.crjxfhwlldui.us-east-1.rds.amazonaws.com:5432/tidelog?sslmode=require',
    ),
  ).toBe(true)
})

test('looksLikeProd: false for empty/undefined url', () => {
  expect(looksLikeProd(undefined)).toBe(false)
  expect(looksLikeProd('')).toBe(false)
})

test('looksLikeProd: false for non-URL string', () => {
  expect(looksLikeProd('not-a-url')).toBe(false)
})
