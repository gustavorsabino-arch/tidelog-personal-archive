// DB access for budget adjustments. Thin wrapper over the budget_adjustment
// table; the overlay math lives in adjustments.ts (pure).

import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '@/lib/db'
import { budgetAdjustment } from '@/lib/db/schema/budget'
import type { AdjustmentRecord } from './adjustments.ts'
import type { BudgetDepartment, BudgetMonthKey } from './types.ts'

export type BudgetAdjustment = AdjustmentRecord & {
  id: string
  year: number
  notes: string
  createdBy: string
  createdAt: string
  reversedBy: string | null
  reversedAt: string | null
}

export type CreateBudgetAdjustmentInput = {
  year: number
  department: BudgetDepartment
  lineItem: string
  kind: 'one_time' | 'recurring'
  amount: number
  startPeriod: BudgetMonthKey
  durationMonths: number
  notes: string
  createdBy: string
}

function toIso(value: unknown): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function toRecord(row: typeof budgetAdjustment.$inferSelect): BudgetAdjustment {
  return {
    id: row.id,
    year: row.year,
    department: row.department,
    lineItem: row.lineItem,
    kind: row.kind,
    amount: Number(row.amount),
    startPeriod: row.startPeriod as BudgetMonthKey,
    durationMonths: row.durationMonths,
    status: row.status,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt) ?? '',
    reversedBy: row.reversedBy ?? null,
    reversedAt: toIso(row.reversedAt),
  }
}

export async function loadBudgetAdjustments(
  year: number,
  departments?: BudgetDepartment[],
): Promise<BudgetAdjustment[]> {
  const conditions = [eq(budgetAdjustment.year, year)]
  if (departments && departments.length > 0) {
    conditions.push(inArray(budgetAdjustment.department, departments))
  }
  const rows = await db
    .select()
    .from(budgetAdjustment)
    .where(and(...conditions))
    .orderBy(desc(budgetAdjustment.createdAt))
  return rows.map(toRecord)
}

export async function createBudgetAdjustment(input: CreateBudgetAdjustmentInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(budgetAdjustment)
    .values({
      year: input.year,
      department: input.department,
      lineItem: input.lineItem,
      kind: input.kind,
      amount: String(input.amount),
      startPeriod: input.startPeriod,
      durationMonths: input.durationMonths,
      notes: input.notes,
      createdBy: input.createdBy,
    })
    .returning({ id: budgetAdjustment.id })
  return { id: row.id }
}

export async function reverseBudgetAdjustment(id: string, actor: string): Promise<void> {
  await db
    .update(budgetAdjustment)
    .set({ status: 'reversed', reversedBy: actor, reversedAt: new Date() })
    .where(eq(budgetAdjustment.id, id))
}
