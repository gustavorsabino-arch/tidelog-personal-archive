import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot } from '@/lib/db/schema/financial'
import { wallet } from '@/lib/db/schema/reference'
import { getCurrentPrices } from '@/lib/defillama'
import { STABLE_TOKENS } from '@/lib/constants'

export type OnchainTokenRow = {
  token: string
  amount: number
  priceUsd: number
  usd: number
  walletCount: number
}

export type OnchainSummary = {
  totalUsd: number
  snapshotDate: string | null
  walletCount: number
  byToken: OnchainTokenRow[]
}

/**
 * Aggregate the most recent on-chain balance snapshot for an entity's wallets.
 * Uses whatever the latest snapshot date is per (wallet, token); joins with
 * the latest `price` row per token. Stablecoins fall back to $1 if no price
 * row exists.
 */
export async function getEntityOnchainSummary(entityId: string): Promise<OnchainSummary> {
  const wallets = await db
    .select({ address: wallet.address })
    .from(wallet)
    .where(and(eq(wallet.entityId, entityId), eq(wallet.isExternal, false)))

  if (wallets.length === 0) {
    return { totalUsd: 0, snapshotDate: null, walletCount: 0, byToken: [] }
  }
  const addresses = wallets.map((w) => w.address)

  // Latest snapshot per (wallet, token)
  const snapshots = await db
    .select({
      walletAddress: balanceSnapshot.walletAddress,
      token: balanceSnapshot.token,
      amount: balanceSnapshot.amount,
      date: balanceSnapshot.date,
      rn: sql<number>`row_number() over (partition by ${balanceSnapshot.walletAddress}, ${balanceSnapshot.token} order by ${balanceSnapshot.date} desc)`.as('rn'),
    })
    .from(balanceSnapshot)
    .where(inArray(balanceSnapshot.walletAddress, addresses))

  const latest = snapshots.filter((r) => r.rn === 1)
  if (latest.length === 0) {
    return { totalUsd: 0, snapshotDate: null, walletCount: wallets.length, byToken: [] }
  }

  const tokenSymbols = Array.from(new Set(latest.map((r) => r.token)))
  const currentPrices = tokenSymbols.length > 0 ? await getCurrentPrices() : {}
  const priceByToken = new Map<string, number>(Object.entries(currentPrices))

  // Aggregate by token
  const agg = new Map<string, { amount: number; wallets: Set<string>; latestDate: string }>()
  for (const row of latest) {
    const entry = agg.get(row.token) ?? { amount: 0, wallets: new Set<string>(), latestDate: row.date }
    entry.amount += Number(row.amount)
    entry.wallets.add(row.walletAddress)
    if (row.date > entry.latestDate) entry.latestDate = row.date
    agg.set(row.token, entry)
  }

  const byToken: OnchainTokenRow[] = []
  let totalUsd = 0
  let snapshotDate: string | null = null
  for (const [token, entry] of agg) {
    const priceUsd = priceByToken.get(token) ?? (STABLE_TOKENS.has(token) ? 1 : 0)
    const usd = entry.amount * priceUsd
    totalUsd += usd
    if (!snapshotDate || entry.latestDate > snapshotDate) snapshotDate = entry.latestDate
    byToken.push({ token, amount: entry.amount, priceUsd, usd, walletCount: entry.wallets.size })
  }
  byToken.sort((a, b) => b.usd - a.usd)

  return { totalUsd, snapshotDate, walletCount: wallets.length, byToken }
}
