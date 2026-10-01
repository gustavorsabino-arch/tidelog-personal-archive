import { test, expect, beforeEach } from 'bun:test'
import { runCron } from './runner'

beforeEach(() => {
  process.env.CRON_SECRET = 'correct-secret'
})

test('returns 401 when Authorization header missing', async () => {
  const req = new Request('http://localhost/api/cron/test')
  const res = await runCron('test', req, async () => ({ ok: true }))
  expect(res.status).toBe(401)
  const body = await res.json()
  expect(body.code).toBe('cron.unauthorized')
})

test('returns 401 with wrong secret', async () => {
  const req = new Request('http://localhost/api/cron/test', {
    headers: { authorization: 'Bearer wrong-secret' },
  })
  const res = await runCron('test', req, async () => ({ ok: true }))
  expect(res.status).toBe(401)
})

test('returns 401 if Bearer prefix missing', async () => {
  const req = new Request('http://localhost/api/cron/test', {
    headers: { authorization: 'correct-secret' },   // no 'Bearer ' prefix
  })
  const res = await runCron('test', req, async () => ({ ok: true }))
  expect(res.status).toBe(401)
})

test('returns 500 if CRON_SECRET not configured', async () => {
  delete process.env.CRON_SECRET
  const req = new Request('http://localhost/api/cron/test', {
    headers: { authorization: 'Bearer anything' },
  })
  const res = await runCron('test', req, async () => ({ ok: true }))
  expect(res.status).toBe(500)
  const body = await res.json()
  expect(body.code).toBe('cron.misconfigured')
})

test('accepts correct secret and returns job result', async () => {
  const req = new Request('http://localhost/api/cron/test', {
    headers: { authorization: 'Bearer correct-secret' },
  })
  const res = await runCron('test', req, async () => ({ ok: true, processed: 5 }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.processed).toBe(5)
})

test('reports an incomplete job as a failure', async () => {
  const req = new Request('http://localhost/api/cron/test', {
    headers: { authorization: 'Bearer correct-secret' },
  })
  const res = await runCron('test', req, async () => ({ ok: false, gainsFailed: 1 }))
  expect(res.status).toBe(500)
  expect((await res.json()).gainsFailed).toBe(1)
})

test('catches job errors and returns 500', async () => {
  const req = new Request('http://localhost/api/cron/test', {
    headers: { authorization: 'Bearer correct-secret' },
  })
  const res = await runCron('test', req, async () => {
    throw new Error('job went boom')
  })
  expect(res.status).toBe(500)
  const body = await res.json()
  expect(body.code).toBe('cron.failed')
  expect(body.error).toBe('job went boom')
})
