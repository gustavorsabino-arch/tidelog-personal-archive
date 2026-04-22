import { test, expect } from 'bun:test'
import { hasPermission, PERMISSIONS } from './permissions'

test('admin has all permissions', () => {
  for (const p of PERMISSIONS) {
    expect(hasPermission('admin', p)).toBe(true)
  }
})

test('budget_viewer only has budget:read', () => {
  expect(hasPermission('budget_viewer', 'budget:read')).toBe(true)
  expect(hasPermission('budget_viewer', 'budget:write')).toBe(false)
  expect(hasPermission('budget_viewer', 'treasury:read')).toBe(false)
  expect(hasPermission('budget_viewer', 'qb:read')).toBe(false)
  expect(hasPermission('budget_viewer', 'qb:post')).toBe(false)
  expect(hasPermission('budget_viewer', 'admin:manage_users')).toBe(false)
  expect(hasPermission('budget_viewer', 'admin:manage_data')).toBe(false)
  expect(hasPermission('budget_viewer', 'admin:*')).toBe(false)
})

test('null role has no permissions', () => {
  for (const p of PERMISSIONS) {
    expect(hasPermission(null, p)).toBe(false)
  }
})

test('undefined role has no permissions', () => {
  for (const p of PERMISSIONS) {
    expect(hasPermission(undefined, p)).toBe(false)
  }
})

test('unknown role has no permissions', () => {
  expect(hasPermission('unknown' as any, 'budget:read')).toBe(false)
  expect(hasPermission('superadmin' as any, 'admin:*')).toBe(false)
})

test('empty string role has no permissions', () => {
  expect(hasPermission('', 'budget:read')).toBe(false)
})
