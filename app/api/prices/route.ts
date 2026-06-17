import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { getCurrentPrices } from '@/lib/prices'

export async function GET(req: Request) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const { prices } = await getCurrentPrices()
  return NextResponse.json({ prices, lastUpdated: null })
}
