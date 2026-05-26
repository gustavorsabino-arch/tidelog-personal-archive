// Pure helper for extracting a row's counterparty / payee / employee name
// from a cached transaction payload. Sibling to `gl-class-match.ts`.
//
// For Bills / Purchase / VendorCredit / Deposit / Invoice the body-level
// VendorRef / PayeeRef / EntityRef / CustomerRef carries the name shown in
// QB's Name column. For Journal Entries the per-line
// `JournalEntryLineDetail.Entity.EntityRef.name` (or CustomerRef) is the
// authoritative source.
//
// GL responses don't reliably populate the Name column for these resource
// types (especially JE rows). This enricher fills in `name` from the cached
// payload so the drill matches v1 / QB's own UI.

import { type CachedTransactionPayload } from '@/lib/qb/cache-reads'
import { type ParsedQboGeneralLedgerRow } from '@/lib/budget/qb-general-ledger'

const RESOURCE_TYPE_TO_WRAPPER: Readonly<Record<string, string>> = {
  bill: 'Bill',
  deposit: 'Deposit',
  journalentry: 'JournalEntry',
  purchase: 'Purchase',
  vendorcredit: 'VendorCredit',
  invoice: 'Invoice',
}

type QboRef = { value?: string; name?: string }

type QboLineDetail = {
  AccountRef?: QboRef
  Entity?: { EntityRef?: QboRef }
  CustomerRef?: QboRef
}

type QboLine = {
  DetailType?: string
  Amount?: number | string
} & Record<string, unknown>

type QboBody = {
  Line?: QboLine[]
  VendorRef?: QboRef
  PayeeRef?: QboRef
  EntityRef?: QboRef
  CustomerRef?: QboRef
}

function getLineDetail(line: QboLine): QboLineDetail | null {
  const detailKey = line.DetailType
  if (!detailKey) return null
  const detail = (line as Record<string, unknown>)[detailKey]
  if (!detail || typeof detail !== 'object') return null
  return detail as QboLineDetail
}

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) < 0.005
}

function toNumber(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function pickLineEntityName(line: QboLine): string | null {
  const detail = getLineDetail(line)
  if (!detail) return null
  const fromEntity = detail.Entity?.EntityRef?.name?.trim()
  if (fromEntity) return fromEntity
  const fromCustomer = detail.CustomerRef?.name?.trim()
  if (fromCustomer) return fromCustomer
  return null
}

function pickBodyEntityName(body: QboBody | undefined): string | null {
  if (!body) return null
  return body.VendorRef?.name?.trim()
    || body.PayeeRef?.name?.trim()
    || body.EntityRef?.name?.trim()
    || body.CustomerRef?.name?.trim()
    || null
}

function findEntityName(
  payload: unknown,
  resourceType: string,
  qbAccountId: string,
  expectedAmount: number | null,
): string | null {
  const wrapperKey = RESOURCE_TYPE_TO_WRAPPER[resourceType]
  if (!wrapperKey) return null
  const wrapped = (payload as Record<string, QboBody | undefined> | null | undefined)?.[wrapperKey]
  if (!wrapped) return null
  const lines = wrapped.Line

  // For JEs, the per-line Entity.EntityRef.name is the right source.
  // Two-phase match: account+amount first, then account-only fallback.
  if (Array.isArray(lines)) {
    if (expectedAmount !== null) {
      for (const line of lines) {
        const detail = getLineDetail(line)
        if (!detail) continue
        if (detail.AccountRef?.value !== qbAccountId) continue
        const lineAmount = toNumber(line.Amount)
        if (lineAmount === null || !amountsMatch(lineAmount, expectedAmount)) continue
        const name = pickLineEntityName(line)
        if (name) return name
      }
    }
    for (const line of lines) {
      const detail = getLineDetail(line)
      if (!detail) continue
      if (detail.AccountRef?.value !== qbAccountId) continue
      const name = pickLineEntityName(line)
      if (name) return name
    }
  }

  // For Bills / Purchase / VendorCredit / Deposit / Invoice, the
  // body-level vendor/payee is the canonical source.
  return pickBodyEntityName(wrapped)
}

/**
 * Pure enrichment — given parsed GL rows and a pre-loaded payload map, fill
 * `name` from the payload where present. Overwrites the parser's value when
 * the payload yields a confirmed name (payload is authoritative); leaves
 * the parser's value untouched when no match is found.
 */
export function enrichRowsWithNameFromPayloads(
  rows: readonly ParsedQboGeneralLedgerRow[],
  qbAccountId: string,
  payloadMap: ReadonlyMap<string, CachedTransactionPayload>,
): ParsedQboGeneralLedgerRow[] {
  return rows.map((row) => {
    if (!row.txnId) return { ...row }
    const record = payloadMap.get(row.txnId)
    if (!record) return { ...row }
    try {
      const name = findEntityName(
        record.payload,
        record.resourceType,
        qbAccountId,
        row.amountUsd,
      )
      if (name) return { ...row, name }
      return { ...row }
    } catch (err) {
      console.warn(
        `[gl-name-match] payload navigation failed for txn ${row.txnId}:`,
        err,
      )
      return { ...row }
    }
  })
}
