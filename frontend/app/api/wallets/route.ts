import { NextRequest, NextResponse } from 'next/server'
import wallets from '@/data/wallets.json'

type Wallet = {
  address: string
  label: string
  chain: string
  entity: string
  accountCode: string | null
  isExternal: boolean
  overviewOnly?: boolean
  includeInOverview?: boolean
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entity = searchParams.get('entity')
  const chain = searchParams.get('chain')
  const external = searchParams.get('external')

  let filtered = wallets as Wallet[]
  if (entity)   filtered = filtered.filter(w => w.entity === entity)
  if (chain)    filtered = filtered.filter(w => w.chain === chain)
  if (external === 'true')  filtered = filtered.filter(w => w.isExternal)
  if (external === 'false') filtered = filtered.filter(w => !w.isExternal)

  return NextResponse.json({ wallets: filtered, total: filtered.length })
}
