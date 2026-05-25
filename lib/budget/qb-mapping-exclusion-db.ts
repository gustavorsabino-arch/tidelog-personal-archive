import { eq, inArray } from 'drizzle-orm'

import { db } from '@/lib/db'
import { budgetQbMapping, budgetQbMappingExclusion } from '@/lib/db/schema/budget'
import type { BudgetQbMappingExclusionRow } from './types.ts'

export function normalizeExclusionRow(row: {
  qbAccountNumber: string
  reason: string
  updatedAt: Date | null
}): BudgetQbMappingExclusionRow {
  return {
    accountNumber: row.qbAccountNumber.trim(),
    reason: row.reason,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
  }
}

export async function loadBudgetQbMappingExclusions(): Promise<BudgetQbMappingExclusionRow[]> {
  const rows = await db.select().from(budgetQbMappingExclusion)
  return rows.map(normalizeExclusionRow).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
}

export type AddBudgetQbMappingExclusionResult =
  | { ok: true; row: BudgetQbMappingExclusionRow }
  | { ok: false; conflictLine: string; conflictKey: string }

export async function addBudgetQbMappingExclusion(input: {
  accountNumber: string
  reason: string
}): Promise<AddBudgetQbMappingExclusionResult> {
  const accountNumber = input.accountNumber.trim()
  const reason = input.reason.trim()
  if (!accountNumber) throw new Error('accountNumber is required')
  if (!reason) throw new Error('reason is required')

  return db.transaction(async (tx) => {
    const mappingHit = await tx
      .select({ lineItem: budgetQbMapping.lineItem })
      .from(budgetQbMapping)
      .where(eq(budgetQbMapping.qbAccountNumber, accountNumber))
      .limit(1)
    if (mappingHit.length > 0) {
      return { ok: false, conflictKey: mappingHit[0].lineItem, conflictLine: mappingHit[0].lineItem } as const
    }

    const now = new Date()
    await tx
      .insert(budgetQbMappingExclusion)
      .values({ qbAccountNumber: accountNumber, reason, updatedAt: now })
      .onConflictDoUpdate({
        target: budgetQbMappingExclusion.qbAccountNumber,
        set: { reason, updatedAt: now },
      })

    return {
      ok: true,
      row: { accountNumber, reason, updatedAt: now.toISOString() },
    } as const
  })
}

export async function removeBudgetQbMappingExclusion(accountNumber: string): Promise<void> {
  const trimmed = accountNumber.trim()
  if (!trimmed) return
  await db
    .delete(budgetQbMappingExclusion)
    .where(eq(budgetQbMappingExclusion.qbAccountNumber, trimmed))
}

export async function deleteBudgetQbMappingExclusionsByAccount(
  accountNumbers: readonly string[],
  tx: typeof db = db,
): Promise<number> {
  const cleaned = Array.from(new Set(accountNumbers.map((value) => value.trim()).filter(Boolean)))
  if (cleaned.length === 0) return 0
  await tx
    .delete(budgetQbMappingExclusion)
    .where(inArray(budgetQbMappingExclusion.qbAccountNumber, cleaned))
  return cleaned.length
}
