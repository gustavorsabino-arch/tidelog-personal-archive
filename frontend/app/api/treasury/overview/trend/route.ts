import { NextRequest, NextResponse } from 'next/server'
import { listDataFilesStrict, readDataFileStrict } from '@/lib/github'
import { buildTrendPoint } from '@/lib/overview-trend'
import type { BalanceSnapshot, TreasuryOverviewTrendResponse } from '@/lib/types'

const EMPTY_SNAPSHOT: BalanceSnapshot = {
  date: '',
  fetchedAt: '',
  prices: {},
  balances: {},
}

// GET /api/treasury/overview/trend?wallet=<addr>&tokens=USDC,USDT&days=90
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const walletAddr = searchParams.get('wallet')?.trim()
  const tokens = (searchParams.get('tokens') || '')
    .split(',')
    .map(token => token.trim())
    .filter(Boolean)
  const days = Math.max(1, Math.min(180, Number.parseInt(searchParams.get('days') || '90', 10) || 90))

  if (!walletAddr) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }

  if (!tokens.length) {
    return NextResponse.json({ error: 'tokens is required' }, { status: 400 })
  }

  const filesResult = await listDataFilesStrict('balances')
  if (!filesResult.ok) {
    return NextResponse.json({ error: filesResult.error }, { status: filesResult.status || 500 })
  }

  const files = filesResult.found
    ? filesResult.files.filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().slice(-days)
    : []

  const snapshotResults = await Promise.all(
    files.map(file => readDataFileStrict<BalanceSnapshot>(`balances/${file}`))
  )

  const points: TreasuryOverviewTrendResponse['points'] = snapshotResults
    .filter((result): result is { ok: true; found: true; data: BalanceSnapshot } => result.ok && result.found)
    .map(result => buildTrendPoint(result.data || EMPTY_SNAPSHOT, walletAddr, tokens))

  const response: TreasuryOverviewTrendResponse = {
    walletAddr,
    tokens,
    points,
    firstDate: points[0]?.date || null,
    lastDate: points[points.length - 1]?.date || null,
  }

  return NextResponse.json(response)
}
