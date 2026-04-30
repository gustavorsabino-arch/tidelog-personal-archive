import { readCachedPerAccountGeneralLedgersInRange } from '@/lib/qb/cache-reads'
import type { QboEntity } from '@/lib/qb/config'

import type { QboGeneralLedgerReport, QboReportRow } from './actuals.ts'
import { isExcludedBudgetQboClassName } from './qb-class.ts'

/**
 * Sum the amount of every Data row whose Class column matches the Council
 * exclusion predicate. Walks rows recursively so it works for both
 * per-account GL (the shape the cron writes — one row per
 * (entity, account, month)) and any wrapping section structure QB happens
 * to use. The caller is responsible for grouping by account; this function
 * just totals one report.
 */
export function sumCouncilFromGeneralLedgerReport(
  report: QboGeneralLedgerReport,
): number {
  let total = 0

  function walk(rows: QboReportRow[] | undefined) {
    if (!rows) return
    for (const row of rows) {
      if (row.type === 'Data' && row.ColData) {
        const className = row.ColData[4]?.value?.trim() ?? ''
        const amount = Number.parseFloat(row.ColData[6]?.value || '0') || 0
        if (amount !== 0 && isExcludedBudgetQboClassName(className)) {
          total += amount
        }
      }
      if (row.Rows?.Row) walk(row.Rows.Row)
    }
  }

  walk(report?.Rows?.Row)
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
