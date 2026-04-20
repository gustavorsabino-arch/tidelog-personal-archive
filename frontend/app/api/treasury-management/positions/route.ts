import { NextRequest, NextResponse } from 'next/server'
import { getTreasuryManagementData } from '@/lib/treasury-management'

export async function GET(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get('entity')

  try {
    const result = await getTreasuryManagementData({ entity })
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
