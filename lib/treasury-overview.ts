import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot, wallet } from '@/lib/db/schema'
import { buildTreasuryOverview } from '@/lib/overview'
import { toDisplayEntity } from '@/lib/entity'
import { getCurrentPrices } from '@/lib/defillama'
import type { BalanceSnapshot, Prices, TreasuryOverview, Wallet } from '@/lib/types'

export async function getTreasuryOverview(entityFilter?: string | null): Promise<TreasuryOverview> {
  // Fetch wallet roster, latest balance snapshot, and current prices in one
  // round-trip set. The balance snapshot uses an inline subselect for max(date)
  // so we don't pay an extra round-trip after the parallel batch.
  const [walletRows, balanceRows, currentPrices] = await Promise.all([
    db.select().from(wallet).orderBy(wallet.label),
    db.select().from(balanceSnapshot).where(
      eq(balanceSnapshot.date, sql`(select max(${balanceSnapshot.date}) from ${balanceSnapshot})`),
    ),
    getCurrentPrices(),
  ])

  const latestDate = balanceRows[0]?.date ?? null

  const balances: BalanceSnapshot['balances'] = {}
  for (const row of balanceRows) {
    const walletBalances = balances[row.walletAddress] ?? {}
    walletBalances[row.token] = Number(row.amount)
    balances[row.walletAddress] = walletBalances
  }

  const prices: Prices = currentPrices

  const mostRecentFetched = balanceRows.reduce<Date | null>((acc, row) => {
    const t = row.fetchedAt
    if (!acc || (t && t > acc)) return t
    return acc
  }, null)

  const snapshot: BalanceSnapshot = {
    date: latestDate ?? '',
    fetchedAt: mostRecentFetched ? mostRecentFetched.toISOString() : '',
    prices,
    balances,
  }

  const registry: Wallet[] = walletRows.map((w) => ({
    address: w.address,
    label: w.label,
    chain: w.chain,
    entity: toDisplayEntity(w.entityId),
    accountCode: w.accountCode,
    isExternal: w.isExternal,
    overviewOnly: w.overviewOnly,
    includeInOverview: w.includeInOverview,
  }))

  return buildTreasuryOverview(registry, snapshot, prices, entityFilter ?? null)
}
