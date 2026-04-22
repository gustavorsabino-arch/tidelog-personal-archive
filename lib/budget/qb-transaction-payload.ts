import { getQboRealmId, type QboEntity } from '../qb/config.ts'

import { normalizeBudgetDepartmentName } from './departments.ts'
import type { ParsedQboGeneralLedgerRow } from './qb-general-ledger.ts'
import type { BudgetDepartment } from './types.ts'

type QboRef = {
  value?: string
  name?: string
}

type QboTransactionLine = {
  Amount?: number | string
  Description?: string
  DetailType?: string
  JournalEntryLineDetail?: {
    AccountRef?: QboRef
    ClassRef?: QboRef
    DepartmentRef?: QboRef
    LocationRef?: QboRef
    PostingType?: string
    Entity?: {
      EntityRef?: QboRef
    }
  }
  AccountBasedExpenseLineDetail?: {
    AccountRef?: QboRef
    ClassRef?: QboRef
    DepartmentRef?: QboRef
    LocationRef?: QboRef
    CustomerRef?: QboRef
  }
  ItemBasedExpenseLineDetail?: {
    ClassRef?: QboRef
    DepartmentRef?: QboRef
    LocationRef?: QboRef
    CustomerRef?: QboRef
  }
}

type QboTransactionBody = {
  TxnDate?: string
  DocNumber?: string
  PrivateNote?: string
  Line?: QboTransactionLine[]
  VendorRef?: QboRef
  PayeeRef?: QboRef
  EntityRef?: QboRef
  DepartmentRef?: QboRef
  LocationRef?: QboRef
  ClassRef?: QboRef
}

type QboTransactionPayload = {
  JournalEntry?: QboTransactionBody
  Bill?: QboTransactionBody
  Check?: QboTransactionBody
  Purchase?: QboTransactionBody
  VendorCredit?: QboTransactionBody
  CreditCardCredit?: QboTransactionBody
  CreditCardPaymentTxn?: QboTransactionBody
  Transfer?: QboTransactionBody
  Deposit?: QboTransactionBody
  Invoice?: QboTransactionBody
  Payment?: QboTransactionBody
  BillPayment?: QboTransactionBody
  SalesReceipt?: QboTransactionBody
  RefundReceipt?: QboTransactionBody
  CreditMemo?: QboTransactionBody
}

export type BudgetQboTransactionResource =
  | 'journalentry'
  | 'bill'
  | 'check'
  | 'purchase'
  | 'vendorcredit'
  | 'creditcardcredit'
  | 'creditcardpaymenttxn'
  | 'transfer'
  | 'deposit'
  | 'invoice'
  | 'payment'
  | 'billpayment'
  | 'salesreceipt'
  | 'refundreceipt'
  | 'creditmemo'

export type BudgetQboNormalizedTransactionLine = {
  accountId: string | null
  accountName: string | null
  className: string | null
  normalizedDepartment: BudgetDepartment | null
  amountUsd: number | null
  description: string | null
  entityName: string | null
}

export type BudgetQboTransactionPayloadRecord = {
  txnId: string
  transactionType: string
  resourceType: BudgetQboTransactionResource | null
  sourceRowDate: string | null
  sourceRowClassName: string | null
  txDate: string | null
  documentNumber: string | null
  memo: string | null
  counterpartyName: string | null
  lines: BudgetQboNormalizedTransactionLine[]
  error: string | null
}

export type BudgetQboTransactionPayloadCache = Map<string, Promise<BudgetQboTransactionPayloadRecord>>

type FetchBudgetQboTransactionPayloadRecordsOptions = {
  entity: QboEntity
  parsedRows: readonly ParsedQboGeneralLedgerRow[]
  limit?: number | null
  cache?: BudgetQboTransactionPayloadCache
  // Required so this module never reaches out to live QuickBooks. Production
  // callers wire in a cache-backed fetcher (see lib/qb/cache-reads.ts); tests
  // pass a fake.
  fetchTransactionPayload: (entity: QboEntity, path: string) => Promise<QboTransactionPayload>
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function parseAmount(value: number | string | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null

  const wrappedNegative = trimmed.startsWith('(') && trimmed.endsWith(')')
  const normalized = trimmed.replace(/[,$]/g, '').replace(/[()]/g, '')
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed)) return null
  return wrappedNegative ? -parsed : parsed
}

function normalizeSignedAmount(
  resourceType: BudgetQboTransactionResource | null,
  line: QboTransactionLine,
): number | null {
  const amount = parseAmount(line.Amount)
  if (amount === null) return null

  const absAmount = Math.abs(amount)
  const postingType = normalizeText(line.JournalEntryLineDetail?.PostingType)?.toLowerCase()
  if (resourceType === 'journalentry') {
    if (postingType === 'credit') return -absAmount
    if (postingType === 'debit') return absAmount
    return amount
  }

  if (resourceType === 'vendorcredit' || resourceType === 'creditcardcredit') {
    return -absAmount
  }

  return amount
}

function normalizeTransactionType(transactionType: string | null): BudgetQboTransactionResource | null {
  const value = String(transactionType ?? '').trim().toLowerCase()
  if (!value) return null
  if (value.includes('journal')) return 'journalentry'
  if (value === 'bill') return 'bill'
  if (value === 'check') return 'check'
  if (value.includes('vendor credit')) return 'vendorcredit'
  if (value === 'purchase' || value === 'expense') return 'purchase'
  if (value === 'transfer') return 'transfer'
  if (value === 'deposit') return 'deposit'
  if (value === 'invoice') return 'invoice'
  if (value === 'payment') return 'payment'
  if (value.includes('bill payment')) return 'billpayment'
  if (value.includes('sales receipt')) return 'salesreceipt'
  if (value.includes('refund receipt')) return 'refundreceipt'
  if (value.includes('credit memo')) return 'creditmemo'
  // Credit Card Payment / Credit Card Credit are UI-only types in QBO REST
  // — no endpoint. Skip; the GL-row transaction still appears without
  // payload enrichment.
  if (value.includes('credit card')) return null
  return null
}

function buildTransactionPath(entity: QboEntity, resource: BudgetQboTransactionResource, txnId: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/${resource}/${encodeURIComponent(txnId)}?minorversion=65`
}

function pickPayloadRoot(payload: QboTransactionPayload): {
  resourceType: BudgetQboTransactionResource | null
  body: QboTransactionBody | null
} {
  if (payload.JournalEntry) return { resourceType: 'journalentry', body: payload.JournalEntry }
  if (payload.Bill) return { resourceType: 'bill', body: payload.Bill }
  if (payload.Check) return { resourceType: 'check', body: payload.Check }
  if (payload.Purchase) return { resourceType: 'purchase', body: payload.Purchase }
  if (payload.VendorCredit) return { resourceType: 'vendorcredit', body: payload.VendorCredit }
  if (payload.CreditCardCredit) return { resourceType: 'creditcardcredit', body: payload.CreditCardCredit }
  if (payload.CreditCardPaymentTxn) return { resourceType: 'creditcardpaymenttxn', body: payload.CreditCardPaymentTxn }
  if (payload.Transfer) return { resourceType: 'transfer', body: payload.Transfer }
  if (payload.Deposit) return { resourceType: 'deposit', body: payload.Deposit }
  if (payload.Invoice) return { resourceType: 'invoice', body: payload.Invoice }
  if (payload.Payment) return { resourceType: 'payment', body: payload.Payment }
  if (payload.BillPayment) return { resourceType: 'billpayment', body: payload.BillPayment }
  if (payload.SalesReceipt) return { resourceType: 'salesreceipt', body: payload.SalesReceipt }
  if (payload.RefundReceipt) return { resourceType: 'refundreceipt', body: payload.RefundReceipt }
  if (payload.CreditMemo) return { resourceType: 'creditmemo', body: payload.CreditMemo }
  return { resourceType: null, body: null }
}

/**
 * Extract a department-like label from a QB line. In order:
 *   1. ClassRef (Classes feature)
 *   2. DepartmentRef (Departments feature, available on JournalEntry line
 *      details for Plus and Advanced tiers)
 *   3. LocationRef (Locations feature, alias for Department in some tiers)
 *
 * Zagreus's QB company tracks department via DepartmentRef/LocationRef
 * rather than ClassRef, so Classes-only parsing returned null and dropped
 * every Zagreus transaction into "Not specified".
 *
 * If a line carries none of the three, the caller's header-level fallback
 * (see `resolveDepartmentRef` on the body) kicks in.
 */
function pickLineDepartmentRef(line: QboTransactionLine): QboRef | undefined {
  const journalDetail = line.JournalEntryLineDetail
  const expenseDetail = line.AccountBasedExpenseLineDetail
  const itemDetail = line.ItemBasedExpenseLineDetail

  return journalDetail?.ClassRef ?? expenseDetail?.ClassRef ?? itemDetail?.ClassRef
    ?? journalDetail?.DepartmentRef ?? expenseDetail?.DepartmentRef ?? itemDetail?.DepartmentRef
    ?? journalDetail?.LocationRef ?? expenseDetail?.LocationRef ?? itemDetail?.LocationRef
}

function pickBodyDepartmentRef(body: QboTransactionBody | null): QboRef | undefined {
  if (!body) return undefined
  return body.ClassRef ?? body.DepartmentRef ?? body.LocationRef
}

function normalizeTransactionLine(
  resourceType: BudgetQboTransactionResource | null,
  line: QboTransactionLine,
  bodyDepartmentRef: QboRef | undefined,
): BudgetQboNormalizedTransactionLine {
  const journalDetail = line.JournalEntryLineDetail
  const expenseDetail = line.AccountBasedExpenseLineDetail
  const itemDetail = line.ItemBasedExpenseLineDetail

  const accountRef = journalDetail?.AccountRef ?? expenseDetail?.AccountRef
  const departmentRef = pickLineDepartmentRef(line) ?? bodyDepartmentRef
  const entityRef = journalDetail?.Entity?.EntityRef ?? expenseDetail?.CustomerRef ?? itemDetail?.CustomerRef

  return {
    accountId: normalizeText(accountRef?.value),
    accountName: normalizeText(accountRef?.name),
    className: normalizeText(departmentRef?.name),
    normalizedDepartment: normalizeBudgetDepartmentName(String(departmentRef?.name ?? '').trim()),
    amountUsd: normalizeSignedAmount(resourceType, line),
    description: normalizeText(line.Description),
    entityName: normalizeText(entityRef?.name),
  }
}

async function runWithConcurrency<T, TResult>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const queue = [...items]
  const results: TResult[] = []
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length || 1)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      results.push(await worker(item))
    }
  })

  await Promise.all(workers)
  return results
}

export async function fetchBudgetQboTransactionPayloadRecords(
  options: FetchBudgetQboTransactionPayloadRecordsOptions,
): Promise<BudgetQboTransactionPayloadRecord[]> {
  const { fetchTransactionPayload } = options
  const cache = options.cache ?? new Map<string, Promise<BudgetQboTransactionPayloadRecord>>()
  const candidateRows = options.limit === null
    ? options.parsedRows.filter((row) => row.txnId && row.transactionType)
    : options.parsedRows
      .filter((row) => row.txnId && row.transactionType)
      .slice(0, Math.max(0, options.limit ?? options.parsedRows.length))

  const uniqueRows = new Map<string, ParsedQboGeneralLedgerRow>()
  for (const row of candidateRows) {
    const resource = normalizeTransactionType(row.transactionType)
    if (!resource || !row.txnId) continue
    const key = `${options.entity}:${resource}:${row.txnId}`
    if (!uniqueRows.has(key)) uniqueRows.set(key, row)
  }

  const rows = Array.from(uniqueRows.values())
  return runWithConcurrency(rows, 4, async (row) => {
    const resource = normalizeTransactionType(row.transactionType)
    if (!resource || !row.txnId) {
      return {
        txnId: row.txnId ?? 'unknown',
        transactionType: row.transactionType ?? 'Unknown',
        resourceType: resource,
        sourceRowDate: row.date,
        sourceRowClassName: row.className,
        txDate: row.date,
        documentNumber: row.documentNumber,
        memo: row.memo,
        counterpartyName: row.name,
        lines: [],
        error: 'Unsupported transaction type for payload lookup',
      }
    }

    const cacheKey = `${options.entity}:${resource}:${row.txnId}`
    let cached = cache.get(cacheKey)
    if (!cached) {
      cached = (async () => {
        try {
          const payload = await fetchTransactionPayload(options.entity, buildTransactionPath(options.entity, resource, row.txnId!))
          const root = pickPayloadRoot(payload)
          const body = root.body
          const bodyDepartmentRef = pickBodyDepartmentRef(body)
          const lines = (body?.Line ?? []).map(
            (line) => normalizeTransactionLine(root.resourceType ?? resource, line, bodyDepartmentRef),
          )

          return {
            txnId: row.txnId!,
            transactionType: row.transactionType ?? 'Unknown',
            resourceType: root.resourceType ?? resource,
            sourceRowDate: row.date,
            sourceRowClassName: row.className,
            txDate: normalizeText(body?.TxnDate) ?? row.date,
            documentNumber: normalizeText(body?.DocNumber) ?? row.documentNumber,
            memo: normalizeText(body?.PrivateNote) ?? row.memo,
            counterpartyName: normalizeText(body?.VendorRef?.name)
              ?? normalizeText(body?.PayeeRef?.name)
              ?? normalizeText(body?.EntityRef?.name)
              ?? row.name,
            lines,
            error: null,
          } satisfies BudgetQboTransactionPayloadRecord
        } catch (error) {
          return {
            txnId: row.txnId!,
            transactionType: row.transactionType ?? 'Unknown',
            resourceType: resource,
            sourceRowDate: row.date,
            sourceRowClassName: row.className,
            txDate: row.date,
            documentNumber: row.documentNumber,
            memo: row.memo,
            counterpartyName: row.name,
            lines: [],
            error: error instanceof Error ? error.message : 'Failed to fetch transaction payload',
          } satisfies BudgetQboTransactionPayloadRecord
        }
      })()
      cache.set(cacheKey, cached)
    }

    return cached
  })
}
