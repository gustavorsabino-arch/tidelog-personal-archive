import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot, wallet } from '@/lib/db/schema'
import { buildTreasuryOverview } from '@/lib/overview'
import { toDisplayEntity } from '@/lib/entity'
import { getCurrentPrices } from '@/lib/defillama'
import type { BalanceSnapshot, Prices, TreasuryOverview, Wallet } from '@/lib/types'

export async function getTreasuryOverview(entityFilter?: string | null): Promise<TreasuryOverview> {
  const [walletRows, latestDateRows, currentPrices] = await Promise.all([
    db.select().from(wallet).orderBy(wallet.label),
    db.select({ date: balanceSnapshot.date }).from(balanceSnapshot).orderBy(desc(balanceSnapshot.date)).limit(1),
    getCurrentPrices(),
  ])

  const latestDate = latestDateRows[0]?.date ?? null
  const balanceRows = latestDate
    ? await db.select().from(balanceSnapshot).where(eq(balanceSnapshot.date, latestDate))
    : []

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
