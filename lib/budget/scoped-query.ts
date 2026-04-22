import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { budgetLine, budgetTeamMember, budgetQbMapping } from '@/lib/db/schema/budget'
import type { ServerUser } from '@/lib/auth/get-user'

/**
 * Department-scoped query helpers for budget tables.
 *
 * Callers MUST use these — never query budget_* tables directly, otherwise
 * budget_viewer users will see all departments.
 *
 * Admins see everything. Budget viewers with no departments see nothing.
 */

export async function scopedBudgetLines(user: ServerUser) {
  if (user.role === 'admin') return db.select().from(budgetLine)
  if (user.departments.length === 0) return []
  return db.select().from(budgetLine).where(inArray(budgetLine.department, user.departments))
}

export async function scopedBudgetTeam(user: ServerUser) {
  if (user.role === 'admin') return db.select().from(budgetTeamMember)
  if (user.departments.length === 0) return []
  return db.select().from(budgetTeamMember).where(inArray(budgetTeamMember.department, user.departments))
}

export async function scopedBudgetQbMapping(user: ServerUser) {
  if (user.role === 'admin') return db.select().from(budgetQbMapping)
  if (user.departments.length === 0) return []
  return db.select().from(budgetQbMapping).where(inArray(budgetQbMapping.department, user.departments))
}
