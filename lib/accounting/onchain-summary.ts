import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot } from '@/lib/db/schema/financial'
import { wallet } from '@/lib/db/schema/reference'
import { getCurrentPrices, getClosingPrice } from '@/lib/prices'
import { FOCUS_TOKENS, STABLE_TOKENS } from '@/lib/constants'

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
 * Aggregate the on-chain balance snapshot for an entity's wallets.
 *
 * - `asOf` null/undefined → latest snapshot per (wallet, token), current prices.
 * - `asOf = "YYYY-MM-DD"` → latest snapshot per (wallet, token) with date ≤ asOf,
 *   priced at DefiLlama historical for that date. Mirrors the Overview page's
 *   as-of behavior so both views reconcile when the same date is picked.
 *
 * Stablecoins fall back to $1 if no price row exists.
 */
export async function getEntityOnchainSummary(
  entityId: string,
  asOf?: string | null,
): Promise<OnchainSummary> {
  // Strict ISO date — anything else falls back to "latest" so a typo'd query
  // doesn't 500 the entire page.
  const asOfDate = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null

  const wallets = await db
    .select({ address: wallet.address })
    .from(wallet)
    .where(and(eq(wallet.entityId, entityId), eq(wallet.type, 'internal'), eq(wallet.hiddenFromFinance, false)))

  if (wallets.length === 0) {
    return { totalUsd: 0, snapshotDate: null, walletCount: 0, byToken: [] }
  }
  const addresses = wallets.map((w) => w.address)

  // Latest snapshot per (wallet, token), optionally bounded by date <= asOf.
  const snapshots = await db
    .select({
      walletAddress: balanceSnapshot.walletAddress,
      token: balanceSnapshot.token,
      amount: balanceSnapshot.amount,
      date: balanceSnapshot.date,
      rn: sql<number>`(row_number() over (partition by ${balanceSnapshot.walletAddress}, ${balanceSnapshot.token} order by ${balanceSnapshot.date} desc))::int`.as('rn'),
    })
    .from(balanceSnapshot)
    .where(
      asOfDate
        ? and(
            inArray(balanceSnapshot.walletAddress, addresses),
            sql`${balanceSnapshot.date} <= ${asOfDate}`,
          )
        : inArray(balanceSnapshot.walletAddress, addresses),
    )

  const latest = snapshots.filter((r) => r.rn === 1)
  if (latest.length === 0) {
    return { totalUsd: 0, snapshotDate: asOfDate, walletCount: wallets.length, byToken: [] }
  }

  const tokenSymbols = Array.from(new Set(latest.map((r) => r.token)))
  const priceMap = asOfDate
    ? await getHistoricalPricesAtDate(asOfDate)
    : (tokenSymbols.length > 0 ? (await getCurrentPrices()).prices : {})
  const priceByToken = new Map<string, number>(Object.entries(priceMap))

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

/**
 * Closing prices (23:59:59 UTC) for FOCUS_TOKENS on the given as-of date, via
 * the price wrapper (Birdeye → DeFiLlama). Same helper pattern as
 * treasury-overview so both views resolve the exact same prices for any date.
 */
async function getHistoricalPricesAtDate(asOf: string): Promise<Record<string, number>> {
  const dayTs = Math.floor(Date.parse(`${asOf}T00:00:00Z`) / 1000)
  if (!Number.isFinite(dayTs)) return {}
  const results = await Promise.all(
    FOCUS_TOKENS.map(async (sym) => [sym, await getClosingPrice(sym, dayTs)] as const),
  )
  const out: Record<string, number> = {}
  for (const [sym, r] of results) {
    if (r) out[sym] = r.price
  }
  return out
}
