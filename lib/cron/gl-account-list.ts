const PNL_ACCOUNT_TYPES = new Set([
  'Income', 'Expense', 'Other Income', 'Other Expense', 'Cost of Goods Sold',
])

export type GlAccountTuple = { accountNumber: string; accountId: string }

export type CatalogAccountRow = {
  accountNumber: string | null
  accountId: string
  accountType: string | null
}

/**
 * Combine budget-mapped account numbers with all P&L-typed accounts in the
 * catalog. Dedupes by accountNumber. Drops catalog rows missing accountNumber
 * (we need it for cache-read keys).
 *
 * Pure — no DB or network. Lives outside `fetch-qb-reports.ts` so tests can
 * import it without triggering the cron module's DB-env requirements.
 */
export function buildGlAccountList(
  budgetAccountNumbers: readonly string[],
  catalog: readonly CatalogAccountRow[],
): GlAccountTuple[] {
  const byNumber = new Map<string, GlAccountTuple>()
  for (const row of catalog) {
    if (!row.accountNumber) continue
    if (!byNumber.has(row.accountNumber) && row.accountType && PNL_ACCOUNT_TYPES.has(row.accountType)) {
      byNumber.set(row.accountNumber, { accountNumber: row.accountNumber, accountId: row.accountId })
    }
  }
  const idByNumber = new Map<string, string>()
  for (const row of catalog) {
    if (row.accountNumber) idByNumber.set(row.accountNumber, row.accountId)
  }
  for (const accountNumber of budgetAccountNumbers) {
    if (byNumber.has(accountNumber)) continue
    const accountId = idByNumber.get(accountNumber)
    if (!accountId) continue
    byNumber.set(accountNumber, { accountNumber, accountId })
  }
  return [...byNumber.values()].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
}
