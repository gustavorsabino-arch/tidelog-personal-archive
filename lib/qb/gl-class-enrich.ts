import 'server-only'

import {
  readCachedTransactionPayloads,
  type CachedTransactionPayload,
} from '@/lib/qb/cache-reads'
import { type QboEntity } from '@/lib/qb/config'
import { type ParsedQboGeneralLedgerRow } from '@/lib/budget/qb-general-ledger'

// QB stores cached transactions with a lowercase resource_type. The payload
// itself wraps the data under a PascalCase key matching the QB resource name.
// Unknown resource types fall through to "no enrichment" — the row's className
// stays whatever the parser set (typically null), so coverage just degrades
// rather than breaks.
const RESOURCE_TYPE_TO_WRAPPER: Readonly<Record<string, string>> = {
  bill: 'Bill',
  deposit: 'Deposit',
  journalentry: 'JournalEntry',
  purchase: 'Purchase',
  vendorcredit: 'VendorCredit',
  invoice: 'Invoice',
}

type QboLineDetail = {
  AccountRef?: { value?: string; name?: string }
  ClassRef?: { value?: string; name?: string }
}

type QboLine = {
  DetailType?: string
  Amount?: number | string
} & Record<string, unknown>

type QboTxnPayload = Record<string, { Line?: QboLine[] } | undefined>

function getLineDetail(line: QboLine): QboLineDetail | null {
  const detailKey = line.DetailType
  if (!detailKey) return null
  const detail = (line as Record<string, unknown>)[detailKey]
  if (!detail || typeof detail !== 'object') return null
  return detail as QboLineDetail
}

function amountsMatch(a: number, b: number): boolean {
  // QB GL signs amounts differently from transaction payloads (debit vs.
  // credit conventions, negative for refunds, etc.). Match magnitude only.
  return Math.abs(Math.abs(a) - Math.abs(b)) < 0.005
}

function toNumber(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Try to find the line that matches both account and amount; if no amount
 * match, fall back to first account-only match. Returns the class name or
 * null when nothing matches or the line has no class.
 *
 * The two-phase match handles the multi-line same-account case: a JE with two
 * lines on account X with different amounts has two GL rows, each carrying
 * its own Amount. Matching by (account, amount) lets each GL row pick its
 * own line. If amount also collides (rare — typically synthetic), we accept
 * the first account match; the lines on the same account+amount must share
 * the same business intent so the class is likely identical anyway.
 */
function findLineClass(
  payload: unknown,
  resourceType: string,
  qbAccountId: string,
  expectedAmount: number | null,
): string | null {
  const wrapperKey = RESOURCE_TYPE_TO_WRAPPER[resourceType]
  if (!wrapperKey) return null

  const wrapped = (payload as QboTxnPayload | null | undefined)?.[wrapperKey]
  const lines = wrapped?.Line
  if (!Array.isArray(lines)) return null

  // Pass 1 — require account AND amount match.
  if (expectedAmount !== null) {
    for (const line of lines) {
      const detail = getLineDetail(line)
      if (!detail) continue
      if (detail.AccountRef?.value !== qbAccountId) continue
      const lineAmount = toNumber(line.Amount)
      if (lineAmount === null || !amountsMatch(lineAmount, expectedAmount)) continue
      const className = detail.ClassRef?.name?.trim()
      if (className) return className
      // Account+amount matched but no class — keep looking in case a
      // duplicate-account/amount line later carries the class.
    }
  }

  // Pass 2 — account match only.
  for (const line of lines) {
    const detail = getLineDetail(line)
    if (!detail) continue
    if (detail.AccountRef?.value !== qbAccountId) continue
    const className = detail.ClassRef?.name?.trim()
    if (className) return className
  }

  return null
}

/**
 * Pure synchronous enrichment — no DB. Given parsed GL rows and a pre-loaded
 * payload map, fill in `className` where missing by looking up each row's
 * `txnId` in the payload map and matching by (qbAccountId, amount).
 *
 * Preserves any non-null className already on a row (treated as authoritative).
 */
export function enrichRowsWithClassFromPayloads(
  rows: readonly ParsedQboGeneralLedgerRow[],
  qbAccountId: string,
  payloadMap: ReadonlyMap<string, CachedTransactionPayload>,
): ParsedQboGeneralLedgerRow[] {
  return rows.map((row) => {
    if (row.className || !row.txnId) return { ...row }
    const record = payloadMap.get(row.txnId)
    if (!record) return { ...row }

    try {
      const className = findLineClass(
        record.payload,
        record.resourceType,
        qbAccountId,
        row.amountUsd,
      )
      if (className) return { ...row, className }
      return { ...row }
    } catch (err) {
      // Defensive: a malformed payload shouldn't take down a request. Log
      // once at warn and leave the row unenriched.
      console.warn(
        `[gl-class-enrich] payload navigation failed for txn ${row.txnId}:`,
        err,
      )
      return { ...row }
    }
  })
}

/**
 * Async wrapper: collects distinct txnIds from `rows`, bulk-loads payloads
 * from qb_transaction_cache, then delegates to the pure enrichment helper.
 * On cache-read error, returns rows unchanged (fail-open — the drawer still
 * shows what it would have shown without enrichment).
 *
 * Performance note: callers that already preloaded payloads (e.g.
 * `qb-department-actuals.ts` builds an entity-wide payload map up front
 * for amount-backfill) MUST pass it via `opts.payloadMap`. Without it,
 * this function re-queries the DB once per account-task — which on
 * `entity=All` department views is ~300+ redundant roundtrips per
 * request and made the page take many seconds to switch departments.
 */
export async function enrichGlRowsWithClass(
  rows: readonly ParsedQboGeneralLedgerRow[],
  entity: QboEntity,
  qbAccountId: string,
  opts?: { payloadMap?: ReadonlyMap<string, CachedTransactionPayload> },
): Promise<ParsedQboGeneralLedgerRow[]> {
  // Fast path: caller already has the payloads in memory — skip DB entirely.
  if (opts?.payloadMap) {
    return enrichRowsWithClassFromPayloads(rows, qbAccountId, opts.payloadMap)
  }

  const txnIds = Array.from(
    new Set(rows.filter((r) => !r.className && r.txnId).map((r) => r.txnId!)),
  )
  if (txnIds.length === 0) return rows.map((r) => ({ ...r }))

  let payloadMap: Map<string, CachedTransactionPayload>
  try {
    payloadMap = await readCachedTransactionPayloads(entity, txnIds)
  } catch (err) {
    console.warn(
      `[gl-class-enrich] readCachedTransactionPayloads failed for ${entity}:`,
      err,
    )
    return rows.map((r) => ({ ...r }))
  }

  return enrichRowsWithClassFromPayloads(rows, qbAccountId, payloadMap)
}
