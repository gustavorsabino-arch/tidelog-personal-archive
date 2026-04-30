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
