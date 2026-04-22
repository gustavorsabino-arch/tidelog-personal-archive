import { ENTITY_COLORS, STABLE_TOKENS, TOKEN_COLORS } from '@/lib/constants'
import type {
  BalanceSnapshot,
  Prices,
  TreasuryOverviewDrilldown,
  TreasuryOverviewDrilldownRow,
  TreasuryOverview,
  TreasuryOverviewEntityTotal,
  TreasuryOverviewTokenTotal,
  TreasuryOverviewWallet,
  Wallet,
} from '@/lib/types'

export function shouldIncludeInOverview(wallet: Wallet): boolean {
  // External wallets (counterparties) are excluded by default. They only
  // appear in Overview if explicitly flagged `overviewOnly` — a rare case for
  // a tracked non-operational wallet we want visible (e.g. a custody partner).
  if (wallet.isExternal) return wallet.overviewOnly === true
  // Internal wallets are included by default; explicit false hides them.
  return wallet.includeInOverview !== false
}

export function getWalletTypeLabel(wallet: Wallet): string {
  if (shouldIncludeInOverview(wallet) && wallet.isExternal) return 'Overview Included'
  if (wallet.isExternal) return 'External'
  return 'Operational'
}

export function extractLatestPrices(priceCache: Record<string, unknown>): Prices {
  const prices: Prices = {}

  for (const [key, value] of Object.entries(priceCache)) {
    if (!key.endsWith('::latest') || typeof value !== 'number') continue
    const token = key.slice(0, key.indexOf('::latest'))
    prices[token] = value
  }

  return prices
}

export function getTokenUsdValue(token: string, amount: number, prices: Prices): number {
  if (!amount) return 0
  if (STABLE_TOKENS.has(token)) return amount

  const price = prices[token]
  return typeof price === 'number' ? amount * price : 0
}

export function buildTreasuryOverview(
  registry: Wallet[],
  snapshot: BalanceSnapshot,
  prices: Prices,
  entityFilter?: string | null
): TreasuryOverview {
  const wallets: TreasuryOverviewWallet[] = []
  const entityTotals: Record<string, TreasuryOverviewEntityTotal> = {}
  const tokenTotals: Record<string, TreasuryOverviewTokenTotal> = {}

  for (const wallet of registry) {
    if (entityFilter && wallet.entity !== entityFilter) continue
    if (!shouldIncludeInOverview(wallet)) continue

    const balances = snapshot.balances?.[wallet.address] || {}
    const tokenUsd: Record<string, number> = {}
    let totalUSD = 0

    for (const [token, amount] of Object.entries(balances)) {
      const usd = getTokenUsdValue(token, amount, prices)
      tokenUsd[token] = usd
      totalUSD += usd
    }

    const overviewWallet: TreasuryOverviewWallet = { ...wallet, balances, tokenUsd, totalUSD }
    wallets.push(overviewWallet)

    if (!entityTotals[wallet.entity]) {
      entityTotals[wallet.entity] = {
        tokens: {},
        tokenUsd: {},
        totalUSD: 0,
        walletCount: 0,
      }
    }

    const entityTotal = entityTotals[wallet.entity]
    entityTotal.totalUSD += totalUSD
    entityTotal.walletCount++

    for (const [token, amount] of Object.entries(balances)) {
      const usd = tokenUsd[token] || 0
      entityTotal.tokens[token] = (entityTotal.tokens[token] || 0) + amount
      entityTotal.tokenUsd[token] = (entityTotal.tokenUsd[token] || 0) + usd

      if (!tokenTotals[token]) {
        tokenTotals[token] = { amount: 0, usd: 0, walletCount: 0 }
      }

      tokenTotals[token].amount += amount
      tokenTotals[token].usd += usd
      if (amount > 0) tokenTotals[token].walletCount++
    }
  }

  return {
    prices,
    wallets,
    entityTotals,
    tokenTotals,
    snapshotDate: snapshot.date || null,
    fetchedAt: snapshot.fetchedAt || null,
    grandTotalUSD: wallets.reduce((sum, wallet) => sum + wallet.totalUSD, 0),
  }
}

export function getSortedActiveTokens(tokenTotals: Record<string, TreasuryOverviewTokenTotal>): string[] {
  return Object.entries(tokenTotals)
    .filter(([, summary]) => summary.amount > 0)
    .sort((a, b) => {
      if (b[1].usd !== a[1].usd) return b[1].usd - a[1].usd
      return b[1].amount - a[1].amount
    })
    .map(([token]) => token)
}

function sumWalletTokens(wallet: TreasuryOverviewWallet, tokens: string[]): number {
  return tokens.reduce((sum, token) => sum + (wallet.tokenUsd[token] || 0), 0)
}

export function buildOverviewDrilldown(
  overview: TreasuryOverview,
  key: string
): TreasuryOverviewDrilldown | null {
  const wallets = overview.wallets
  const grandTotalUSD = overview.grandTotalUSD
  const activeTokens = getSortedActiveTokens(overview.tokenTotals)
  let title = ''
  let accentColor = 'var(--accent)'
  let filteredWallets: TreasuryOverviewWallet[] = wallets
  let rowTokens: string[] = []
  let showEntityColumn = false

  if (key === 'stables') {
    rowTokens = activeTokens.filter(token => STABLE_TOKENS.has(token))
    filteredWallets = wallets.filter(wallet => rowTokens.some(token => (wallet.balances[token] || 0) > 0))
    title = 'Stablecoins — All Entities'
    accentColor = '#2775CA'
    showEntityColumn = true
  } else if (key.startsWith('token:')) {
    const token = key.slice('token:'.length)
    rowTokens = [token]
    filteredWallets = wallets.filter(wallet => (wallet.balances[token] || 0) > 0)
    title = `${token} — All Entities`
    accentColor = TOKEN_COLORS[token] || TOKEN_COLORS.default
    showEntityColumn = true
  } else if (key.startsWith('entity:')) {
    const [, entity, scope, scopeToken] = key.split(':')
    filteredWallets = wallets.filter(wallet => wallet.entity === entity)
    accentColor = ENTITY_COLORS[entity] || TOKEN_COLORS.default

    if (scope === 'all') {
      rowTokens = activeTokens.filter(token => filteredWallets.some(wallet => (wallet.balances[token] || 0) > 0))
      title = `${entity} — All Wallets`
    } else if (scope === 'token' && scopeToken) {
      rowTokens = [scopeToken]
      filteredWallets = filteredWallets.filter(wallet => (wallet.balances[scopeToken] || 0) > 0)
      title = `${entity} — ${scopeToken}`
      accentColor = TOKEN_COLORS[scopeToken] || accentColor
    } else {
      return null
    }
  } else {
    return null
  }

  if (!rowTokens.length) {
    rowTokens = []
  }

  const rows: TreasuryOverviewDrilldownRow[] = filteredWallets
    .map(wallet => ({
      walletAddr: wallet.address,
      walletLabel: wallet.label,
      entity: wallet.entity,
      totalUSD: sumWalletTokens(wallet, rowTokens),
      tokenAmounts: Object.fromEntries(rowTokens.map(token => [token, wallet.balances[token] || 0])),
      tokenUsd: Object.fromEntries(rowTokens.map(token => [token, wallet.tokenUsd[token] || 0])),
    }))
    .filter(row => row.totalUSD > 0 || rowTokens.some(token => row.tokenAmounts[token] > 0))
    .sort((a, b) => b.totalUSD - a.totalUSD)

  const subtotalUSD = rows.reduce((sum, row) => sum + row.totalUSD, 0)
  const portfolioPct = grandTotalUSD > 0 ? subtotalUSD / grandTotalUSD * 100 : 0

  return {
    key,
    title,
    accentColor,
    walletCount: rows.length,
    subtotalUSD,
    portfolioPct,
    rowTokens,
    showEntityColumn,
    rows,
  }
}
