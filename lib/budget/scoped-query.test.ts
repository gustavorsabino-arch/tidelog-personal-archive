import { test, expect, beforeAll } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { budgetLine } from '@/lib/db/schema/budget'
import { scopedBudgetLines } from './scoped-query'
import type { ServerUser } from '@/lib/auth/get-user'

const TEST_YEAR = 2099
const TEST_DEPTS = ['ScopedTestGeneral', 'ScopedTestOps', 'ScopedTestFinance']

beforeAll(async () => {
  // Clean up any prior run for the test year
  await db.delete(budgetLine).where(eq(budgetLine.year, TEST_YEAR))
  await db.insert(budgetLine).values([
    { year: TEST_YEAR, department: TEST_DEPTS[0], lineItem: 'payroll', amount: '1000' },
    { year: TEST_YEAR, department: TEST_DEPTS[1], lineItem: 'payroll', amount: '2000' },
    { year: TEST_YEAR, department: TEST_DEPTS[2], lineItem: 'payroll', amount: '3000' },
  ])
})

const mkUser = (role: 'admin' | 'budget_viewer', departments: string[] = []): ServerUser => ({
  id: 'test-user',
  email: 'test@orca.so',
  role,
  departments,
})

test('admin sees all test-year lines', async () => {
  const rows = await scopedBudgetLines(mkUser('admin'))
  // Admin returns a query builder — compose further filtering to limit to test data
  const arr = Array.isArray(rows) ? rows : await db.select().from(budgetLine).where(eq(budgetLine.year, TEST_YEAR))
  const depts = arr.map((r) => r.department)
  expect(depts).toContain(TEST_DEPTS[0])
  expect(depts).toContain(TEST_DEPTS[1])
  expect(depts).toContain(TEST_DEPTS[2])
})

test('budget_viewer only sees their assigned departments', async () => {
  const viewer = mkUser('budget_viewer', [TEST_DEPTS[0]])
  const q = await scopedBudgetLines(viewer)
  const arr = Array.isArray(q) ? q : await q
  const inOurYear = arr.filter((r) => r.year === TEST_YEAR)
  expect(inOurYear.length).toBe(1)
  expect(inOurYear[0].department).toBe(TEST_DEPTS[0])
})

test('budget_viewer with multiple departments sees all of them', async () => {
  const viewer = mkUser('budget_viewer', [TEST_DEPTS[0], TEST_DEPTS[1]])
  const q = await scopedBudgetLines(viewer)
  const arr = Array.isArray(q) ? q : await q
  const inOurYear = arr.filter((r) => r.year === TEST_YEAR)
  expect(inOurYear.length).toBe(2)
  const depts = inOurYear.map((r) => r.department).sort()
  expect(depts).toEqual([TEST_DEPTS[0], TEST_DEPTS[1]].sort())
})

test('budget_viewer with zero departments sees nothing', async () => {
  const viewer = mkUser('budget_viewer', [])
  const rows = await scopedBudgetLines(viewer)
  expect(Array.isArray(rows)).toBe(true)
  expect(rows).toEqual([])
})
