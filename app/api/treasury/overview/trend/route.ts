import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, gte, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot, price } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { buildTrendPoint } from '@/lib/overview-trend'
import { STABLE_TOKENS } from '@/lib/constants'
import type { BalanceSnapshot, Prices, TreasuryOverviewTrendResponse } from '@/lib/types'

// GET /api/treasury/overview/trend?wallet=<addr>&tokens=USDC,USDT&days=90
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const { searchParams } = req.nextUrl
  const walletAddr = searchParams.get('wallet')?.trim()
  const tokens = (searchParams.get('tokens') || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  const days = Math.max(1, Math.min(180, Number.parseInt(searchParams.get('days') || '90', 10) || 90))

  if (!walletAddr) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }
  if (!tokens.length) {
    return NextResponse.json({ error: 'tokens is required' }, { status: 400 })
  }

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  const balanceRows = await db
    .select()
    .from(balanceSnapshot)
    .where(
      and(
        eq(balanceSnapshot.walletAddress, walletAddr),
        inArray(balanceSnapshot.token, tokens),
        gte(balanceSnapshot.date, cutoffIso),
      ),
    )
    .orderBy(asc(balanceSnapshot.date))

  const priceTokens = tokens.filter((token) => !STABLE_TOKENS.has(token))
  const priceRows = priceTokens.length
    ? await db
        .select({ token: price.token, timestamp: price.timestamp, price: price.price })
        .from(price)
        .where(inArray(price.token, priceTokens))
        .orderBy(asc(price.timestamp))
    : []

  const byDate = new Map<string, { balances: Record<string, number>; fetchedAt: Date | null }>()
  for (const row of balanceRows) {
    const entry = byDate.get(row.date) ?? { balances: {}, fetchedAt: null }
    entry.balances[row.token] = Number(row.amount)
    if (row.fetchedAt && (!entry.fetchedAt || row.fetchedAt > entry.fetchedAt)) {
      entry.fetchedAt = row.fetchedAt
    }
    byDate.set(row.date, entry)
  }

  const points = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => {
      const snapshotPrices: Prices = {}
      const dayEnd = new Date(`${date}T23:59:59Z`)
      for (const token of priceTokens) {
        const lastBeforeDay = [...priceRows]
          .filter((row) => row.token === token && row.timestamp <= dayEnd)
          .pop()
        if (lastBeforeDay) {
          snapshotPrices[token] = Number(lastBeforeDay.price)
        }
      }
      const snapshot: BalanceSnapshot = {
        date,
        fetchedAt: entry.fetchedAt ? entry.fetchedAt.toISOString() : '',
        prices: snapshotPrices,
        balances: { [walletAddr]: entry.balances },
      }
      return buildTrendPoint(snapshot, walletAddr, tokens)
    })

  const response: TreasuryOverviewTrendResponse = {
    walletAddr,
    tokens,
    points,
    firstDate: points[0]?.date || null,
    lastDate: points[points.length - 1]?.date || null,
  }

  return NextResponse.json(response)
}
