import { normalizeBudgetQboClassName } from './qb-class.ts'
import type { QboGeneralLedgerReport } from './actuals.ts'
import { parseQboGeneralLedgerRows, type ParsedQboGeneralLedgerRow } from './qb-general-ledger.ts'
import type { BudgetQboTransactionPayloadRecord } from './qb-transaction-payload.ts'
import type {
  BudgetActualDrillAccountSummary,
  BudgetActualDrillTransaction,
  BudgetDepartmentActualScope,
} from './types.ts'

const RIPPLING_NAME_PATTERN = /\[Rippling\]\s+.+?\bfor\s+(.+?)\.?\s*(?:Payroll run|$)/i
const DRILL_VISIBLE_AMOUNT_EPSILON = 0.005

type ParseBudgetActualDrillOptions = {
  entity: string
  realmId: string | null
  accountNumber: string
  accountName: string | null
  amountTransform?: (amountUsd: number) => number
}

export function parseBudgetActualDrillTransactions(
  report: QboGeneralLedgerReport,
  options: ParseBudgetActualDrillOptions,
): BudgetActualDrillTransaction[] {
  return buildBudgetActualDrillTransactionsFromLedgerRows(parseQboGeneralLedgerRows(report), options)
}

export function pickBudgetActualDrillNameFromDescription(description: string | null | undefined): string | null {
  const value = description?.trim() ?? ''
  if (!value) return null

  const ripplingMatch = RIPPLING_NAME_PATTERN.exec(value)
  return ripplingMatch?.[1]?.trim() || null
}

function isBudgetActualDrillAmountVisible(amountUsd: number | null | undefined): amountUsd is number {
  return typeof amountUsd === 'number' && Number.isFinite(amountUsd) && Math.abs(amountUsd) > DRILL_VISIBLE_AMOUNT_EPSILON
}

export function buildBudgetActualDrillTransactionsFromLedgerRows(
  ledgerRows: readonly ParsedQboGeneralLedgerRow[],
  options: ParseBudgetActualDrillOptions,
): BudgetActualDrillTransaction[] {
  const rows: BudgetActualDrillTransaction[] = []
  let rowIndex = 0

  for (const row of ledgerRows) {
    const amountUsd = options.amountTransform ? options.amountTransform(row.amountUsd ?? 0) : row.amountUsd
    if (!isBudgetActualDrillAmountVisible(amountUsd)) continue

    const name = pickBudgetActualDrillNameFromDescription(row.memo) || (row.splitName ? null : row.name)
    rows.push({
      id: `${options.entity}:${options.accountNumber}:${rowIndex}`,
      entity: options.entity,
      realmId: options.realmId,
      txnId: row.txnId,
      accountNumber: options.accountNumber,
      accountName: options.accountName,
      splitName: row.splitName,
      date: row.date,
      transactionType: row.transactionType,
      documentNumber: row.documentNumber,
      name,
      className: row.className,
      normalizedDepartment: normalizeBudgetQboClassName(row.className),
      memo: row.memo,
      amountUsd,
    })
    rowIndex += 1
  }

  return rows
}

export function buildBudgetActualDrillTransactionsFromTransactionPayloads(
  records: readonly BudgetQboTransactionPayloadRecord[],
  accountId: string,
  options: ParseBudgetActualDrillOptions,
): BudgetActualDrillTransaction[] {
  const rows: BudgetActualDrillTransaction[] = []

  for (const record of records) {
    const matchedLines = record.lines.filter((line) => line.accountId === accountId)
    matchedLines.forEach((line, index) => {
      const amountUsd = options.amountTransform ? options.amountTransform(line.amountUsd ?? 0) : (line.amountUsd ?? 0)
      if (!isBudgetActualDrillAmountVisible(amountUsd)) return

      const memo = line.description ?? record.memo
      rows.push({
        id: `${options.entity}:${options.accountNumber}:${record.txnId}:payload:${index}`,
        entity: options.entity,
        realmId: options.realmId,
        txnId: record.txnId,
        accountNumber: options.accountNumber,
        accountName: options.accountName ?? line.accountName,
        splitName: line.accountName ?? options.accountName,
        date: record.txDate ?? record.sourceRowDate,
        transactionType: record.transactionType,
        documentNumber: record.documentNumber,
        name: pickBudgetActualDrillNameFromDescription(memo) ?? line.entityName ?? record.counterpartyName,
        className: line.className ?? record.sourceRowClassName,
        normalizedDepartment: normalizeBudgetQboClassName(line.className ?? record.sourceRowClassName),
        memo,
        amountUsd,
      })
    })
  }

  return rows
}

export function filterBudgetActualDrillTransactions(
  transactions: readonly BudgetActualDrillTransaction[],
  department: BudgetDepartmentActualScope | null,
): BudgetActualDrillTransaction[] {
  if (department === null) return [...transactions]

  if (department === 'Not specified') {
    return transactions.filter((transaction) => transaction.normalizedDepartment === null)
  }

  return transactions.filter((transaction) => transaction.normalizedDepartment === department)
}

export function summarizeBudgetActualDrillAccounts(
  transactions: readonly BudgetActualDrillTransaction[],
  mappingByAccount: Record<string, { mappingKeys: string[]; mappingLines: string[] }>,
): BudgetActualDrillAccountSummary[] {
  const grouped = new Map<string, BudgetActualDrillAccountSummary>()

  for (const transaction of transactions) {
    const existing = grouped.get(transaction.accountNumber)
    if (existing) {
      existing.amountUsd += transaction.amountUsd
      existing.transactionCount += 1
      continue
    }

    const mapping = mappingByAccount[transaction.accountNumber] ?? { mappingKeys: [], mappingLines: [] }
    grouped.set(transaction.accountNumber, {
      accountNumber: transaction.accountNumber,
      accountName: transaction.accountName,
      amountUsd: transaction.amountUsd,
      transactionCount: 1,
      mappingKeys: mapping.mappingKeys,
      mappingLines: mapping.mappingLines,
    })
  }

  return Array.from(grouped.values()).sort((left, right) => right.amountUsd - left.amountUsd)
}

export function pickBudgetActualDrillNameFromJournalEntry(
  lines: readonly { amount: number; name: string }[],
  amountUsd: number,
): string | null {
  const targetAmount = Math.abs(amountUsd)
  const exactMatch = lines.find((line) => Math.abs(line.amount - targetAmount) < 0.02 && line.name)
  if (exactMatch?.name) return exactMatch.name

  return lines.find((line) => line.name)?.name ?? null
}
