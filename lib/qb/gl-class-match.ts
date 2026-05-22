// Pure helpers for matching a GL row to its source-transaction Line entry
// and extracting the ClassRef. No DB, no `'server-only'` — safe to import
// from scripts (e.g. snapshot diff) as well as from Next.js server code.
//
// The async + DB-backed wrapper lives in `./gl-class-enrich.ts`.

import { type CachedTransactionPayload } from '@/lib/qb/cache-reads'
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
        `[gl-class-match] payload navigation failed for txn ${row.txnId}:`,
        err,
      )
      return { ...row }
    }
  })
}
