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
    PostingType?: string
    Entity?: {
      EntityRef?: QboRef
    }
  }
  AccountBasedExpenseLineDetail?: {
    AccountRef?: QboRef
    ClassRef?: QboRef
    CustomerRef?: QboRef
  }
  ItemBasedExpenseLineDetail?: {
    ClassRef?: QboRef
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
}

type QboTransactionPayload = {
  JournalEntry?: QboTransactionBody
  Bill?: QboTransactionBody
  Check?: QboTransactionBody
  Purchase?: QboTransactionBody
  VendorCredit?: QboTransactionBody
  CreditCardCredit?: QboTransactionBody
}

export type BudgetQboTransactionResource = 'journalentry' | 'bill' | 'check' | 'purchase' | 'vendorcredit' | 'creditcardcredit'

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
  fetchTransactionPayload?: (entity: QboEntity, path: string) => Promise<QboTransactionPayload>
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
  if (value.includes('credit card credit')) return 'creditcardcredit'
  if (value.includes('vendor credit')) return 'vendorcredit'
  if (value === 'purchase' || value === 'expense') return 'purchase'
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
  return { resourceType: null, body: null }
}

function normalizeTransactionLine(
  resourceType: BudgetQboTransactionResource | null,
  line: QboTransactionLine,
): BudgetQboNormalizedTransactionLine {
  const journalDetail = line.JournalEntryLineDetail
  const expenseDetail = line.AccountBasedExpenseLineDetail
  const itemDetail = line.ItemBasedExpenseLineDetail

  const accountRef = journalDetail?.AccountRef ?? expenseDetail?.AccountRef
  const classRef = journalDetail?.ClassRef ?? expenseDetail?.ClassRef ?? itemDetail?.ClassRef
  const entityRef = journalDetail?.Entity?.EntityRef ?? expenseDetail?.CustomerRef ?? itemDetail?.CustomerRef

  return {
    accountId: normalizeText(accountRef?.value),
    accountName: normalizeText(accountRef?.name),
    className: normalizeText(classRef?.name),
    normalizedDepartment: normalizeBudgetDepartmentName(String(classRef?.name ?? '').trim()),
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
  const fetchTransactionPayload = options.fetchTransactionPayload ?? (async (entity: QboEntity, path: string) => {
    const { fetchQboJson } = await import('../qb/client.ts')
    return fetchQboJson<QboTransactionPayload>(entity, path)
  })
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
          const lines = (body?.Line ?? []).map((line) => normalizeTransactionLine(root.resourceType ?? resource, line))

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
