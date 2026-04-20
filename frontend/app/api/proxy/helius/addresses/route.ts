import { NextRequest, NextResponse } from 'next/server'

const HELIUS_KEY = process.env.HELIUS_KEY || ''

// GET /api/proxy/helius/addresses?address=xxx&type=transactions&...
// Mirrors: GET /proxy/helius/addresses/:address/transactions on v1 Express
export async function GET(req: NextRequest) {
  if (!HELIUS_KEY) return NextResponse.json({ error: 'Helius not configured' }, { status: 503 })

  const { searchParams } = req.nextUrl
  const address = searchParams.get('address')
  if (!address) return NextResponse.json({ error: 'Missing address' }, { status: 400 })

  const params = new URLSearchParams(searchParams)
  params.delete('address')
  const qs = params.toString()

  try {
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_KEY}${qs ? '&' + qs : ''}`
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
