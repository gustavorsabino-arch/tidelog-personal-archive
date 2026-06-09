// GET /api/tokens
// Returns the full token list. Used by the admin wallet editor's Add-token
// control so any token can be pre-mapped before a first transaction.

import { NextRequest, NextResponse } from 'next/server'
import { asc } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { token } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const rows = await db
    .select({ symbol: token.symbol, name: token.name })
    .from(token)
    .orderBy(asc(token.symbol))

  return NextResponse.json({ tokens: rows })
}
