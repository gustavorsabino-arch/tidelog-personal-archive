import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/require-permission'
import { readCachedBalanceSheet, readLatestCachedBalanceSheetOnOrBefore } from '@/lib/qb/cache-reads'
import { isQboEntity } from '@/lib/qb/config'
import { parseBsReport, type QboBalanceSheetReport } from '@/lib/qb/balance-sheet'
import { getEntityOnchainSummary } from '@/lib/accounting/onchain-summary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  entity: z.string().min(1),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// Reads balance-sheet data from qb_report_cache only. The cron stores a row
// for each month-end plus a rolling "today" row; if no exact match exists for
// the requested asOf date, fall back to the most recent cached snapshot on or
// before it.
export async function GET(req: Request) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', code: 'bs.invalid_query', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { entity, asOf } = parsed.data
  if (!isQboEntity(entity)) {
    return NextResponse.json({ error: 'Invalid entity', code: 'bs.invalid_entity' }, { status: 400 })
  }

  const entityId = entity.toLowerCase()

  const [qbResult, onchain] = await Promise.allSettled([
    (async () => {
      const exact = await readCachedBalanceSheet<QboBalanceSheetReport>(entity, asOf)
      if (exact) return { bs: parseBsReport(exact), bsAsOf: asOf }
      const fallback = await readLatestCachedBalanceSheetOnOrBefore<QboBalanceSheetReport>(entity, asOf)
      if (!fallback) throw new Error(`No cached balance sheet on or before ${asOf}`)
      return { bs: parseBsReport(fallback.data), bsAsOf: fallback.asOfDate }
    })(),
    getEntityOnchainSummary(entityId),
  ])

  const bs = qbResult.status === 'fulfilled' ? qbResult.value.bs : null
  const bsAsOf = qbResult.status === 'fulfilled' ? qbResult.value.bsAsOf : null
  const bsError = qbResult.status === 'rejected'
    ? (qbResult.reason instanceof Error ? qbResult.reason.message : 'Cached balance sheet unavailable')
    : null

  return NextResponse.json({
    entity,
    asOf,
    bsAsOf,
    fetchedAt: new Date().toISOString(),
    bs,
    bsError,
    onchain: onchain.status === 'fulfilled' ? onchain.value : null,
    onchainError: onchain.status === 'rejected'
      ? (onchain.reason instanceof Error ? onchain.reason.message : 'On-chain summary failed')
      : null,
  })
}
