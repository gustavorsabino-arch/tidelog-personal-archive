import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { isQboEntity } from '@/lib/qb/config'
import { getGlForAccount, GlNotCachedError } from '@/lib/qb/gl-data'
import { errorMessage } from '@/lib/errors'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * GET /api/prepayments/gl?entity=Opco&account=14000&from=2025-01-01&to=2026-08-31
 *
 * Live general-ledger rows for the prepaid asset account — the raw material
 * the prepayment map reconciles against. Positive rows = additions (new
 * prepayments), negative rows = amortizations. Reuses the P&L drill's
 * live-first loader (QuickBooks direct, cache fallback).
 */
export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('qb:post', req)
  if (deny) return deny

  const params = new URL(req.url).searchParams
  const entity = params.get('entity')
  const account = params.get('account')?.trim()
  const from = params.get('from')
  const to = params.get('to')
  if (!entity || !isQboEntity(entity)) {
    return NextResponse.json({ error: 'entity must be a QuickBooks entity' }, { status: 400 })
  }
  if (!account) return NextResponse.json({ error: 'account is required' }, { status: 400 })
  const dateOk = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!dateOk(from) || !dateOk(to)) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const result = await getGlForAccount(entity, account, from, to)
    return NextResponse.json({
      rows: result.rows,
      totalAmount: result.totalAmount,
      fetchedAt: result.fetchedAt,
      partial: result.partialEntities.length > 0,
    })
  } catch (err) {
    if (err instanceof GlNotCachedError) {
      return NextResponse.json(
        { error: `No GL data available for account ${account} — check the account number and the QuickBooks connection` },
        { status: 404 },
      )
    }
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}
