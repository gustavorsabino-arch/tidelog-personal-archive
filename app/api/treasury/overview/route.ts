import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot, price, wallet } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { buildTreasuryOverview } from '@/lib/overview'
import { toDisplayEntity } from '@/lib/entity'
import type { BalanceSnapshot, Prices, Wallet } from '@/lib/types'

// GET /api/treasury/overview?entity=Opco
// Returns wallet registry + latest balances + latest prices joined into a
// TreasuryOverview shape matching the previous JSON-file response.
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const { searchParams } = req.nextUrl
  const entityFilter = searchParams.get('entity')

  const [walletRows, latestDateRows, latestPriceRows] = await Promise.all([
    db.select().from(wallet).orderBy(wallet.label),
    db.select({ date: balanceSnapshot.date }).from(balanceSnapshot).orderBy(desc(balanceSnapshot.date)).limit(1),
    db.select({ token: price.token, price: price.price, timestamp: price.timestamp })
      .from(price)
      .where(eq(price.source, 'latest'))
      .orderBy(desc(price.timestamp)),
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

  const prices: Prices = {}
  for (const row of latestPriceRows) {
    if (prices[row.token] !== undefined) continue
    prices[row.token] = Number(row.price)
  }

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

  const overview = buildTreasuryOverview(registry, snapshot, prices, entityFilter)
  return NextResponse.json(overview)
}
