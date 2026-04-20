import { NextRequest, NextResponse } from 'next/server'

const BIRDEYE_KEY = process.env.BIRDEYE_KEY || ''

export async function GET(req: NextRequest) {
  if (!BIRDEYE_KEY) return NextResponse.json({ error: 'Birdeye not configured' }, { status: 503 })

  const { searchParams } = req.nextUrl
  const apiPath = searchParams.get('path')
  if (!apiPath) return NextResponse.json({ error: 'Missing ?path=' }, { status: 400 })

  // Build upstream URL with remaining params
  const params = new URLSearchParams(searchParams)
  params.delete('path')
  const qs = params.toString()
  const url = `https://public-api.birdeye.so${apiPath}${qs ? '?' + qs : ''}`

  try {
    const r = await fetch(url, {
      headers: {
        'X-API-KEY': BIRDEYE_KEY,
        'x-api-key': BIRDEYE_KEY,
        'x-chain': searchParams.get('chain') || 'solana',
        'accept': 'application/json',
      },
    })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
