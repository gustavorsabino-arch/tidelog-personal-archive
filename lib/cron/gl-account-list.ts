const PNL_ACCOUNT_TYPES = new Set([
  'Income', 'Expense', 'Other Income', 'Other Expense', 'Cost of Goods Sold',
])

// Balance-sheet account types (QBO API names). Cached so the /accounting
// page's amount-click GL drill works — previously only P&L-typed accounts
// had GL cache rows and every balance-sheet drill 404'd gl.not_cached.
// One-time backfill cost on the first cron run after this ships; closed-
// month idempotence keeps every later run cheap.
const BS_ACCOUNT_TYPES = new Set([
  'Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset',
  'Other Asset', 'Accounts Payable', 'Credit Card', 'Other Current Liability',
  'Long Term Liability', 'Equity',
])

const GL_CACHED_ACCOUNT_TYPES = new Set([...PNL_ACCOUNT_TYPES, ...BS_ACCOUNT_TYPES])

export type GlAccountTuple = { accountNumber: string; accountId: string }

export type CatalogAccountRow = {
  accountNumber: string | null
  accountId: string
  accountType: string | null
}

/**
 * Combine budget-mapped account numbers with every P&L-typed AND
 * balance-sheet-typed account in the catalog. Dedupes by accountNumber.
 * Drops catalog rows missing accountNumber (we need it for cache-read keys).
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
    if (!byNumber.has(row.accountNumber) && row.accountType && GL_CACHED_ACCOUNT_TYPES.has(row.accountType)) {
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
