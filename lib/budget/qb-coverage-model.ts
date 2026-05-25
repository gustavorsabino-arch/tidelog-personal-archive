import type { QboProfitAndLossAccountTotals } from './actuals.ts'
import type {
  BudgetCoverageAccountEntry,
  BudgetCoverageStaleMapping,
  BudgetCoverageState,
  BudgetQbMappingExclusionRow,
  BudgetQbMappingRow,
  BudgetViewState,
} from './types.ts'

export function buildBudgetCoverageState(
  view: BudgetViewState,
  mappingRows: readonly BudgetQbMappingRow[],
  accountTotals: QboProfitAndLossAccountTotals,
  accountNames: Record<string, string>,
  mappingSource: BudgetCoverageState['mappingSource'],
  exclusionRows: readonly BudgetQbMappingExclusionRow[],
  catalogAccountNumbers: ReadonlySet<string>,
): BudgetCoverageState {
  const mappedAccountsByNumber = new Map<string, BudgetQbMappingRow>()
  for (const row of mappingRows) {
    for (const account of row.accounts) {
      mappedAccountsByNumber.set(String(account), row)
    }
  }

  const exclusionByAccount = new Map<string, BudgetQbMappingExclusionRow>()
  for (const row of exclusionRows) {
    exclusionByAccount.set(row.accountNumber, row)
  }

  const positiveEntries = Object.entries(accountTotals)
    .filter(([, amount]) => amount > 0)
    .sort((left, right) => right[1] - left[1])

  const mappedAccounts: BudgetCoverageAccountEntry[] = []
  const unmappedAccounts: BudgetCoverageAccountEntry[] = []
  const excludedAccounts: BudgetCoverageAccountEntry[] = []

  // First pass: sum mapped + unmapped for the denominator (excluded amounts are
  // omitted from totalQbUsd entirely so they don't drag coverage % down).
  let denominator = 0
  for (const [accountNumber, amountUsd] of positiveEntries) {
    if (exclusionByAccount.has(accountNumber)) continue
    denominator += amountUsd
  }

  for (const [accountNumber, amountUsd] of positiveEntries) {
    const exclusion = exclusionByAccount.get(accountNumber) ?? null
    const mappingRow = mappedAccountsByNumber.get(accountNumber) ?? null
    const isExcluded = exclusion !== null

    const entry: BudgetCoverageAccountEntry = {
      accountNumber,
      accountName: accountNames[accountNumber] ?? null,
      amountUsd,
      pctOfTotal: denominator > 0 && !isExcluded ? amountUsd / denominator : 0,
      mappingKey: mappingRow?.key ?? null,
      mappingLine: mappingRow?.line ?? null,
      exclusionReason: exclusion?.reason ?? null,
    }

    if (isExcluded) {
      excludedAccounts.push(entry)
    } else if (mappingRow) {
      mappedAccounts.push(entry)
    } else {
      unmappedAccounts.push(entry)
    }
  }

  const mappedUsd = mappedAccounts.reduce((sum, entry) => sum + entry.amountUsd, 0)
  const unmappedUsd = unmappedAccounts.reduce((sum, entry) => sum + entry.amountUsd, 0)
  const excludedUsd = excludedAccounts.reduce((sum, entry) => sum + entry.amountUsd, 0)
  const totalQbUsd = mappedUsd + unmappedUsd

  // Stale mapping detection: any mapped (account, line) pair whose account has
  // no positive activity in the period. Iterate every account on every mapping
  // row so a line that maps multiple accounts can be partially stale.
  const staleMappings: BudgetCoverageStaleMapping[] = []
  for (const row of mappingRows) {
    for (const account of row.accounts) {
      const accountNumber = String(account)
      const amount = accountTotals[accountNumber] ?? 0
      if (amount > 0) continue
      staleMappings.push({
        accountNumber,
        mappingKey: row.key,
        mappingLine: row.line,
        inCatalog: catalogAccountNumbers.has(accountNumber),
      })
    }
  }
  const orphanedMappings = staleMappings.filter((row) => !row.inCatalog)

  return {
    source: 'quickbooks',
    year: view.year,
    view,
    fetchedAt: new Date().toISOString(),
    mappingSource,
    totalQbUsd,
    mappedUsd,
    unmappedUsd,
    excludedUsd,
    coveragePct: totalQbUsd > 0 ? mappedUsd / totalQbUsd : 0,
    mappedAccounts,
    unmappedAccounts,
    excludedAccounts,
    staleMappings,
    orphanedMappings,
  }
}
