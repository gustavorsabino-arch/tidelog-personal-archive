import type { QboProfitAndLossAccountTotals } from './actuals.ts'
import type { BudgetCoverageAccountEntry, BudgetCoverageState, BudgetQbMappingRow, BudgetViewState } from './types.ts'

export function buildBudgetCoverageState(
  view: BudgetViewState,
  mappingRows: readonly BudgetQbMappingRow[],
  accountTotals: QboProfitAndLossAccountTotals,
  accountNames: Record<string, string>,
  mappingSource: BudgetCoverageState['mappingSource'],
): BudgetCoverageState {
  const mappedAccountsByNumber = new Map<string, BudgetQbMappingRow>()
  for (const row of mappingRows) {
    for (const account of row.accounts) {
      mappedAccountsByNumber.set(String(account), row)
    }
  }

  const positiveEntries = Object.entries(accountTotals)
    .filter(([, amount]) => amount > 0)
    .sort((left, right) => right[1] - left[1])

  const totalQbUsd = positiveEntries.reduce((sum, [, amount]) => sum + amount, 0)
  const mappedAccounts: BudgetCoverageAccountEntry[] = []
  const unmappedAccounts: BudgetCoverageAccountEntry[] = []

  for (const [accountNumber, amountUsd] of positiveEntries) {
    const mappingRow = mappedAccountsByNumber.get(accountNumber) ?? null
    const entry: BudgetCoverageAccountEntry = {
      accountNumber,
      accountName: accountNames[accountNumber] ?? null,
      amountUsd,
      pctOfTotal: totalQbUsd > 0 ? amountUsd / totalQbUsd : 0,
      mappingKey: mappingRow?.key ?? null,
      mappingLine: mappingRow?.line ?? null,
    }

    if (mappingRow) {
      mappedAccounts.push(entry)
    } else {
      unmappedAccounts.push(entry)
    }
  }

  const mappedUsd = mappedAccounts.reduce((sum, entry) => sum + entry.amountUsd, 0)
  const unmappedUsd = totalQbUsd - mappedUsd

  return {
    source: 'quickbooks',
    year: view.year,
    view,
    fetchedAt: new Date().toISOString(),
    mappingSource,
    totalQbUsd,
    mappedUsd,
    unmappedUsd,
    coveragePct: totalQbUsd > 0 ? mappedUsd / totalQbUsd : 0,
    mappedAccounts,
    unmappedAccounts,
  }
}
