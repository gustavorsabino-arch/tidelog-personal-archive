import { readCachedPerAccountGeneralLedgersInRange } from '@/lib/qb/cache-reads'
import type { QboEntity } from '@/lib/qb/config'

import type { QboGeneralLedgerReport } from './actuals.ts'
import { parseQboGeneralLedgerRows } from './qb-general-ledger.ts'
import { isExcludedBudgetQboClassName } from './qb-class.ts'

/**
 * Sum the amount of every Data row whose Class column matches the Council
 * exclusion predicate. Delegates row parsing to the same parser the drill
 * uses (`parseQboGeneralLedgerRows`), which locates the amount column
 * dynamically — real cached GL rows have varying column counts, so a
 * fixed-index lookup is unreliable.
 */
export function sumCouncilFromGeneralLedgerReport(
  report: QboGeneralLedgerReport,
): number {
  let total = 0
  for (const row of parseQboGeneralLedgerRows(report)) {
    if (row.amountUsd && isExcludedBudgetQboClassName(row.className)) {
      total += row.amountUsd
    }
  }
  return total
}

export function applyCouncilSubtraction(
  totals: Readonly<Record<string, number>>,
  subtraction: Readonly<Record<string, number>>,
): Record<string, number> {
  const result: Record<string, number> = { ...totals }
  for (const [accountNumber, councilAmount] of Object.entries(subtraction)) {
    if (!councilAmount) continue
    result[accountNumber] = Math.max(0, (result[accountNumber] ?? 0) - councilAmount)
  }
  return result
}

export function filterExcludedClassEntries(
  classified: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [rawClass, amount] of Object.entries(classified)) {
    if (isExcludedBudgetQboClassName(rawClass)) continue
    out[rawClass] = amount
  }
  return out
}

export async function loadCouncilSubtractionByAccount(
  entity: QboEntity,
  start: string,
  end: string,
): Promise<Record<string, number>> {
  const rows = await readCachedPerAccountGeneralLedgersInRange<QboGeneralLedgerReport>(entity, start, end)
  const merged: Record<string, number> = {}
  for (const { accountNumber, data } of rows) {
    const total = sumCouncilFromGeneralLedgerReport(data)
    if (total !== 0) merged[accountNumber] = (merged[accountNumber] ?? 0) + total
  }
  return merged
}
