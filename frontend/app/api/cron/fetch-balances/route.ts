import { NextRequest, NextResponse } from 'next/server'
import { readDataFile, writeDataFile } from '@/lib/github'
import { heliusRpc } from '@/lib/helius'
import { getSym } from '@/lib/constants'
import { extractLatestPrices, shouldIncludeInOverview } from '@/lib/overview'
import type { Wallet } from '@/lib/types'
import walletRegistry from '@/data/wallets.json'

const CRON_SECRET = process.env.CRON_SECRET || ''

async function fetchWalletBalance(address: string): Promise<Record<string, number>> {
  const balances: Record<string, number> = { SOL: 0 }

  const [balRes, tokRes] = await Promise.all([
    heliusRpc('getBalance', [address]),
    heliusRpc('getTokenAccountsByOwner', [
      address,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ]),
  ])

  balances.SOL = (balRes?.result?.value || 0) / 1e9

  for (const acc of (tokRes?.result?.value || [])) {
    const info = acc.account?.data?.parsed?.info
    if (!info) continue
    const sym = getSym(info.mint)
    const amt = parseFloat(info.tokenAmount?.uiAmountString || '0')
    if (sym && amt > 0) {
      balances[sym] = (balances[sym] || 0) + amt
    }
  }

  return balances
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get current prices for USD calculation
    const priceCache = await readDataFile<Record<string, unknown>>('prices.json', {})
    const prices = extractLatestPrices(priceCache)

    // Fetch balances for wallets that participate in overview snapshots.
    const wallets = (walletRegistry as Wallet[]).filter(shouldIncludeInOverview)
    const today = new Date().toISOString().split('T')[0]
    const balanceResults: Record<string, Record<string, number>> = {}
    let success = 0
    let errors = 0

    // Process in parallel batches of 10
    for (let i = 0; i < wallets.length; i += 10) {
      const batch = wallets.slice(i, i + 10)
      const results = await Promise.allSettled(
        batch.map(w => fetchWalletBalance(w.address).then(bal => ({ address: w.address, balances: bal })))
      )

      for (const r of results) {
        if (r.status === 'fulfilled') {
          balanceResults[r.value.address] = r.value.balances
          success++
        } else {
          errors++
        }
      }

      // Small delay between batches
      if (i + 10 < wallets.length) await new Promise(r => setTimeout(r, 200))
    }

    const snapshot = {
      date: today,
      fetchedAt: new Date().toISOString(),
      prices,
      balances: balanceResults,
    }

    await writeDataFile(`balances/${today}.json`, snapshot, `balances: ${today} (${success} wallets)`)

    return NextResponse.json({ ok: true, date: today, success, errors, total: wallets.length })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[Cron:balances]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
