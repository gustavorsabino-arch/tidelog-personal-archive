import { test, expect } from 'bun:test'
import { auth } from './index'

test('databaseHooks.user.create.before blocks creation', async () => {
  const hook = (auth.options as any).databaseHooks?.user?.create?.before
  expect(typeof hook).toBe('function')
  const result = await hook({ id: 'x', email: 'intruder@example.com' }, {})
  expect(result).toBe(false)
})

test('google social provider is configured with disableImplicitSignUp', () => {
  const google = (auth.options as any).socialProviders?.google
  expect(google).toBeDefined()
  expect(google.disableImplicitSignUp).toBe(true)
})
