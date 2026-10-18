import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot, wallet } from '@/lib/db/schema'
import { buildTreasuryOverview } from '@/lib/overview'
import { toDisplayEntity } from '@/lib/entity'
import { getCurrentPrices, getClosingPrice } from '@/lib/prices'
import { FOCUS_TOKENS, STABLE_TOKENS } from '@/lib/constants'
import { getVerifiedHistoricalBalances } from '@/lib/treasury-verified'
import type { BalanceSnapshot, Prices, TreasuryOverview, PriceMeta, PriceSourceTag, PriceKind, Wallet } from '@/lib/types'

/**
 * Treasury overview, optionally as-of a historical date.
 *
 * - `asOf` null/undefined → latest snapshot, current prices (existing behavior).
 * - `asOf = "YYYY-MM-DD"` → Helius historical on-chain balance of each tracked
 *   token at 23:59:59 UTC, priced at the historical daily close. Incomplete
 *   sets fail rather than quietly carrying stale balances forward.
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

  // The latest view still uses the saved Overview snapshots. Historical
  // reporting follows a separate verified on-chain path below.
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
    .where(sql`true`)
    .then((rows) => rows.filter((r) => r.rn === 1).map(({ rn: _rn, ...rest }) => rest))

  const kind: PriceKind = asOfDate ? 'close' : 'live'
  const pricesPromise: Promise<{ prices: Prices; sources: Record<string, PriceSourceTag> }> = asOfDate
    ? getHistoricalPricesAtDate(asOfDate)
    : getCurrentPrices()

  const [walletRows, savedRows, priceResult] = await Promise.all([
    db.select().from(wallet).orderBy(wallet.label),
    balanceQuery,
    pricesPromise,
  ])
  const currentPrices: Prices = priceResult.prices
  const priceSources = priceResult.sources
  const financeWallets = walletRows.filter((w) => w.type === 'internal' && !w.hiddenFromFinance &&
    (!entityFilter || toDisplayEntity(w.entityId) === entityFilter))
  const solWallets = financeWallets.filter((w) => w.chain === 'SOL')
  const manualWallets = financeWallets.filter((w) => w.chain === 'MANUAL')
  const otherChainWallets = financeWallets.filter((w) => w.chain !== 'SOL' && w.chain !== 'MANUAL')
  const historical = asOfDate
    ? await getVerifiedHistoricalBalances(asOfDate,
        walletRows.filter((w) => w.type === 'internal' && !w.hiddenFromFinance && w.chain === 'SOL').map((w) => w.address))
    : null
  const balanceRows = historical ? historical.balances : savedRows
  const latestDate = asOfDate ?? savedRows.reduce<string | null>((latest, row) =>
    !latest || row.date > latest ? row.date : latest, null)

  const balances: BalanceSnapshot['balances'] = {}
  for (const row of balanceRows) {
    const walletBalances = balances[row.walletAddress] ?? {}
    walletBalances[row.token] = Number(row.amount)
    balances[row.walletAddress] = walletBalances
  }
  if (historical) {
    for (const row of historical.balances) {
      if (Number(row.amount) > 0 && !STABLE_TOKENS.has(row.token) && !currentPrices[row.token]) {
        throw new Error(`Historical closing price missing for ${row.token}`)
      }
    }
  }

  const prices: Prices = currentPrices
  const priceMeta: Record<string, PriceMeta> = {}
  for (const token of Object.keys(prices)) {
    const source: PriceSourceTag = STABLE_TOKENS.has(token) ? 'stable' : (priceSources[token] ?? 'defillama')
    priceMeta[token] = { source, kind }
  }

  const mostRecentFetched = savedRows.reduce<Date | null>((acc, row) => {
    const t = row.fetchedAt
    if (!acc || (t && t > acc)) return t
    return acc
  }, null)

  const snapshot: BalanceSnapshot = {
    date: latestDate ?? '',
    fetchedAt: historical?.fetchedAt ?? (mostRecentFetched ? mostRecentFetched.toISOString() : ''),
    prices,
    balances,
  }

  const registry: Wallet[] = (historical ? walletRows.filter((w) => w.chain === 'SOL') : walletRows).map((w) => ({
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

  const lastSavedDateByWallet = new Map<string, string>()
  for (const row of savedRows) {
    const previous = lastSavedDateByWallet.get(row.walletAddress)
    if (!previous || row.date > previous) lastSavedDateByWallet.set(row.walletAddress, row.date)
  }
  const newInternalWallets = financeWallets
    .filter((w) => w.createdAt >= new Date('2026-08-01T00:00:00Z'))
    .map((w) => ({ label: w.label, chain: w.chain, latestBalanceDate: lastSavedDateByWallet.get(w.address) ?? null }))
  const newExternalWallets = walletRows
    .filter((w) => w.type === 'external' && w.createdAt >= new Date('2026-08-01T00:00:00Z') &&
      (!entityFilter || toDisplayEntity(w.entityId) === entityFilter))
    .map((w) => ({ label: w.label, chain: w.chain }))
  const coveredSolWallets = solWallets.filter((w) => lastSavedDateByWallet.has(w.address)).length
  return {
    ...buildTreasuryOverview(registry, snapshot, prices, entityFilter ?? null), priceMeta,
    coverage: {
      source: historical ? 'helius-historical' as const : 'saved-snapshot' as const,
      expectedSolWallets: solWallets.length,
      verifiedSolWallets: historical ? solWallets.length : coveredSolWallets,
      manualWallets: manualWallets.length,
      otherChainWallets: otherChainWallets.length,
      newInternalWallets,
      newExternalWallets,
      limitations: historical
        ? ['Six tracked Solana spot assets only', 'Current wallet ownership/classification is applied to past dates', 'Helius may undercount wallets with multiple token accounts for the same mint']
        : ['Saved balances can be stale', 'Manual bank and protocol positions are not verified on-chain'],
    },
  }
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

