import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { budgetQbMapping, budgetQbMappingExclusion } from '@/lib/db/schema/budget'
import { normalizeBudgetLineKey } from './catalog'
import {
  getDefaultBudgetQbMappingState,
  validateBudgetQbMappingRows,
} from './qb-mapping'
import type { BudgetQbMappingRow, BudgetQbMappingState } from './types'

export async function loadBudgetQbMappingState(year: number, _noCache = false): Promise<BudgetQbMappingState> {
  const rows = await db.select().from(budgetQbMapping)
  if (rows.length === 0) {
    return getDefaultBudgetQbMappingState(year)
  }

  const byKey = new Map<string, { accounts: Set<number>; lastUpdated: string | null }>()
  for (const row of rows) {
    const key = normalizeBudgetLineKey(row.lineItem)
    if (!key) continue
    const account = Number.parseInt(row.qbAccountNumber, 10)
    if (!Number.isFinite(account) || account <= 0) continue
    const existing = byKey.get(key) ?? { accounts: new Set<number>(), lastUpdated: null }
    existing.accounts.add(account)
    const updatedAtIso = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
    if (updatedAtIso && (!existing.lastUpdated || updatedAtIso > existing.lastUpdated)) {
      existing.lastUpdated = updatedAtIso
    }
    byKey.set(key, existing)
  }

  const candidateRows: Array<Partial<BudgetQbMappingRow>> = Array.from(byKey.entries()).map(([key, entry]) => ({
    key,
    accounts: Array.from(entry.accounts).sort((a, b) => a - b),
  }))

  try {
    const normalized = validateBudgetQbMappingRows(candidateRows)
    const lastUpdatedAt = Array.from(byKey.values())
      .map((entry) => entry.lastUpdated)
      .filter((value): value is string => typeof value === 'string')
      .sort()
      .at(-1) ?? null
    return {
      version: 1,
      year,
      rows: normalized.length > 0 ? normalized : getDefaultBudgetQbMappingState(year).rows,
      source: 'data-branch',
      lastUpdatedAt,
    }
  } catch (error) {
    console.error('[Budget] Failed to normalize QB mapping; falling back to defaults:', error)
    return getDefaultBudgetQbMappingState(year)
  }
}

const MAPPING_SENTINEL_DEPARTMENT = '_ALL'

/**
 * Replace the entire QB mapping in the DB. Writes a row per (account, lineItem)
 * pair using a sentinel department so the mapping is globally scoped.
 */
export async function saveBudgetQbMappingRows(rows: BudgetQbMappingRow[]): Promise<void> {
  const payload = rows.flatMap((row) =>
    row.accounts.map((account) => ({
      qbAccountNumber: String(account),
      department: MAPPING_SENTINEL_DEPARTMENT,
      lineItem: row.key,
      updatedAt: new Date(),
    })),
  )

  await db.transaction(async (tx) => {
    await tx.delete(budgetQbMapping)
    if (payload.length > 0) {
      const accountNumbers = payload.map((entry) => entry.qbAccountNumber)
      await tx.delete(budgetQbMappingExclusion).where(inArray(budgetQbMappingExclusion.qbAccountNumber, accountNumbers))
      await tx.insert(budgetQbMapping).values(payload)
    }
  })
}
