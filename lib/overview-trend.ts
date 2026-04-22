import { STABLE_TOKENS } from '@/lib/constants'
import type { BalanceSnapshot, Prices, TreasuryOverviewTrendPoint } from '@/lib/types'

function getTokenUsd(token: string, amount: number, prices: Prices): number {
  if (!amount) return 0
  if (STABLE_TOKENS.has(token)) return amount
  const price = prices[token]
  return typeof price === 'number' ? amount * price : 0
}

export function buildTrendPoint(
  snapshot: BalanceSnapshot,
  walletAddr: string,
  tokens: string[]
): TreasuryOverviewTrendPoint {
  const balances = snapshot.balances?.[walletAddr] || {}
  const tokenAmounts: Record<string, number> = {}
  const tokenUsd: Record<string, number> = {}
  let totalUsd = 0

  for (const token of tokens) {
    const amount = balances[token] || 0
    const usd = getTokenUsd(token, amount, snapshot.prices || {})
    tokenAmounts[token] = amount
    tokenUsd[token] = usd
    totalUsd += usd
  }

  return {
    date: snapshot.date,
    totalUsd,
    tokenAmounts,
    tokenUsd,
  }
}
