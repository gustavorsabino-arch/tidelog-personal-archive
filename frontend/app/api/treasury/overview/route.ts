import { NextRequest, NextResponse } from 'next/server'
import { readDataFile, getLatestDataFile } from '@/lib/github'
import type { Wallet, BalanceSnapshot } from '@/lib/types'
import { buildTreasuryOverview, extractLatestPrices } from '@/lib/overview'
import walletRegistry from '@/data/wallets.json'

// GET /api/treasury/overview?entity=Opco
// Returns cached wallet balances + prices from the data branch
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entityFilter = searchParams.get('entity')

  // Read latest balance snapshot from data branch
  const { data: snapshot, filename } = await getLatestDataFile<BalanceSnapshot>(
    'balances',
    { date: '', fetchedAt: '', prices: {}, balances: {} }
  )

  // Read latest prices
  const priceCache = await readDataFile<Record<string, unknown>>('prices.json', {})
  const prices = extractLatestPrices(priceCache)
  const overview = buildTreasuryOverview(walletRegistry as Wallet[], snapshot, prices, entityFilter)

  return NextResponse.json(overview)
}
