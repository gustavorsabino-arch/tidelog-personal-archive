import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot, wallet } from '@/lib/db/schema'
import { buildTreasuryOverview } from '@/lib/overview'
import { toDisplayEntity } from '@/lib/entity'
import { getCurrentPrices, getClosingPrice } from '@/lib/prices'
import { FOCUS_TOKENS, STABLE_TOKENS } from '@/lib/constants'
import type { BalanceSnapshot, Prices, TreasuryOverview, PriceMeta, PriceSourceTag, PriceKind, Wallet } from '@/lib/types'

/**
 * Treasury overview, optionally as-of a historical date.
 *
 * - `asOf` null/undefined → latest snapshot, current prices (existing behavior).
 * - `asOf = "YYYY-MM-DD"` → latest snapshot per (wallet, token) where date ≤ asOf,
 *   priced with DefiLlama historical at that date's midnight UTC. Stablecoins
 *   stay at $1 via the same code path used everywhere else.
 *
 * Coverage caveat: `balance_snapshot` is Solana-only (the EVM cron is a stub),
 * so EVM wallets render as empty at any historical date. Whirlpool LPs and
 * on-chain treasury management positions aren't snapshotted either — this
 * view is SPL spot only.
 */
export async function getTreasuryOverview(
  entityFilter?: string | null,
  asOf?: string | null,
): Promise<TreasuryOverview> {
  // Validate asOf shape before letting it near the SQL builder.
  const asOfDate = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null

  // Latest snapshot per (wallet, token), bounded by asOf when set. Per-wallet
  // partitioning is required — filtering by a single global max(date) would
  // silently drop any wallet whose newest snapshot isn't on that exact date.
  const balanceQuery = db
    .select({
      date: balanceSnapshot.date,
      walletAddress: balanceSnapshot.walletAddress,
      token: balanceSnapshot.token,
      amount: balanceSnapshot.amount,
      fetchedAt: balanceSnapshot.fetchedAt,
      rn: sql<number>`(row_number() over (partition by ${balanceSnapshot.walletAddress}, ${balanceSnapshot.token} order by ${balanceSnapshot.date} desc))::int`.as('rn'),
    })
    .from(balanceSnapshot)
    .where(asOfDate ? sql`${balanceSnapshot.date} <= ${asOfDate}` : sql`true`)
    .then((rows) => rows.filter((r) => r.rn === 1).map(({ rn: _rn, ...rest }) => rest))

  const kind: PriceKind = asOfDate ? 'close' : 'live'
  const pricesPromise: Promise<{ prices: Prices; sources: Record<string, PriceSourceTag> }> = asOfDate
    ? getHistoricalPricesAtDate(asOfDate)
    : getCurrentPrices()

  const [walletRows, balanceRows, priceResult] = await Promise.all([
    db.select().from(wallet).orderBy(wallet.label),
    balanceQuery,
    pricesPromise,
  ])
  const currentPrices: Prices = priceResult.prices
  const priceSources = priceResult.sources

  // For historical view, the displayed snapshot date is the chosen asOf even
  // if no row matches it — finance team wants to know "the report is as of X".
  const latestDate = asOfDate ?? (balanceRows[0]?.date ?? null)

  const balances: BalanceSnapshot['balances'] = {}
  for (const row of balanceRows) {
    const walletBalances = balances[row.walletAddress] ?? {}
    walletBalances[row.token] = Number(row.amount)
    balances[row.walletAddress] = walletBalances
  }

  const prices: Prices = currentPrices
  const priceMeta: Record<string, PriceMeta> = {}
  for (const token of Object.keys(prices)) {
    const source: PriceSourceTag = STABLE_TOKENS.has(token) ? 'stable' : (priceSources[token] ?? 'defillama')
    priceMeta[token] = { source, kind }
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
    type: w.type,
    hiddenFromFinance: w.hiddenFromFinance,
    needsBackfill: w.needsBackfill,
    lastFullBackfillAt: w.lastFullBackfillAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  }))

  return { ...buildTreasuryOverview(registry, snapshot, prices, entityFilter ?? null), priceMeta }
}

// Closing prices (23:59:59 UTC) for all FOCUS_TOKENS on the as-of date, via the
// price wrapper. Returns prices + sources so getTreasuryOverview can build priceMeta.
async function getHistoricalPricesAtDate(
  asOf: string,
): Promise<{ prices: Prices; sources: Record<string, PriceSourceTag> }> {
  const dayTs = Math.floor(Date.parse(`${asOf}T00:00:00Z`) / 1000)
  if (!Number.isFinite(dayTs)) return { prices: {}, sources: {} }
  const results = await Promise.all(
    FOCUS_TOKENS.map(async (sym) => [sym, await getClosingPrice(sym, dayTs)] as const),
  )
  const prices: Prices = {}
  const sources: Record<string, PriceSourceTag> = {}
  for (const [sym, r] of results) {
    if (r) { prices[sym] = r.price; sources[sym] = r.source }
  }
  return { prices, sources }
}
