import { readCachedReportsInRange } from '@/lib/qb/cache-reads'
import type { QboEntity } from '@/lib/qb/config'

import type { QboGeneralLedgerReport, QboReportRow } from './actuals.ts'
import { splitGeneralLedgerByAccount } from './actuals.ts'
import { isExcludedBudgetQboClassName } from './qb-class.ts'

export function sumCouncilByAccountFromGeneralLedger(
  report: QboGeneralLedgerReport,
): Record<string, number> {
  const out: Record<string, number> = {}
  const byAccount = splitGeneralLedgerByAccount(report)

  for (const [accountNumber, perAccount] of byAccount) {
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

    walk(perAccount?.Rows?.Row)
    if (total !== 0) out[accountNumber] = total
  }

  return out
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
  const reports = await readCachedReportsInRange<QboGeneralLedgerReport>(entity, 'general_ledger', start, end)
  const merged: Record<string, number> = {}
  for (const report of reports) {
    const perReport = sumCouncilByAccountFromGeneralLedger(report)
    for (const [accountNumber, amount] of Object.entries(perReport)) {
      merged[accountNumber] = (merged[accountNumber] ?? 0) + amount
    }
  }
  return merged
}
