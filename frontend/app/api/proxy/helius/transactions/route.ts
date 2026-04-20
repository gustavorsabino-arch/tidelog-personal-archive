import { NextRequest, NextResponse } from 'next/server'

const HELIUS_KEY = process.env.HELIUS_KEY || ''

export async function POST(req: NextRequest) {
  if (!HELIUS_KEY) return NextResponse.json({ error: 'Helius not configured' }, { status: 503 })

  try {
    const body = await req.json()
    const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
