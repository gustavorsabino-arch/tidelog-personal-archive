import 'server-only'
import { readCachedBalanceSheet, readLatestCachedBalanceSheetOnOrBefore } from '@/lib/qb/cache-reads'
import { parseBsReport, type BsTree, type QboBalanceSheetReport } from '@/lib/qb/balance-sheet'
import { getEntityOnchainSummary, type OnchainSummary } from '@/lib/accounting/onchain-summary'
import type { QboEntity } from '@/lib/qb/config'

export type BalanceSheetData = {
  entity: string
  asOf: string
  bsAsOf: string | null
  fetchedAt: string
  bs: BsTree | null
  bsError: string | null
  onchain: OnchainSummary | null
  onchainError: string | null
}

export async function getBalanceSheetData(entity: QboEntity, asOf: string): Promise<BalanceSheetData> {
  const entityId = entity.toLowerCase()

  const [qbResult, onchainResult] = await Promise.allSettled([
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

  return {
    entity,
    asOf,
    bsAsOf,
    fetchedAt: new Date().toISOString(),
    bs,
    bsError,
    onchain: onchainResult.status === 'fulfilled' ? onchainResult.value : null,
    onchainError: onchainResult.status === 'rejected'
      ? (onchainResult.reason instanceof Error ? onchainResult.reason.message : 'On-chain summary failed')
      : null,
  }
}
