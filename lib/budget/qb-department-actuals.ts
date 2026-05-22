import {
  buildCachedTransactionPayloadFetcher,
  readCachedAccountCatalogByNumber,
  readCachedGeneralLedgerByAccount,
  readCachedReportsInRange,
  readCachedTransactionPayloads,
  type CachedTransactionPayload,
} from '@/lib/qb/cache-reads'
import { BUDGET_QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'

import {
  composeBudgetActualLineSet,
  getBudgetOverviewActualDateRanges,
  mergeGeneralLedgerReports,
  parseQboProfitAndLossReport,
  type QboGeneralLedgerReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { buildBudgetActualScopeAllocation, getBudgetActualScopeContribution } from './actual-allocation.ts'
import { parseQboGeneralLedgerRows } from './qb-general-ledger.ts'
import { loadBudgetActualLedgerTransactions } from './qb-ledger-transactions.ts'
import { fetchBudgetRevenueLineSet } from './qb-actuals.ts'
import { loadBudgetQbMappingState } from './qb-mapping-db.ts'
import type { BudgetQboTransactionPayloadCache } from './qb-transaction-payload.ts'
import type {
  BudgetDepartmentActualScope,
  BudgetLineAmounts,
  BudgetDepartmentActualsState,
  BudgetQbMappingRow,
  BudgetViewState,
} from './types.ts'

type DepartmentAccountTask = {
  entity: QboEntity
  rowKey: string
  accountNumber: string
  accountTotal: number
  accountId: string | null
}

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

function createEmptyLineAmounts(): BudgetLineAmounts {
  return {}
}

async function readAggregatedPnlTotals(
  entity: QboEntity,
  start: string,
  end: string,
): Promise<Record<string, number>> {
  const reports = await readCachedReportsInRange<QboProfitAndLossReport>(entity, 'profit_and_loss', start, end)
  const totals: Record<string, number> = {}
  for (const report of reports) {
    const monthly = parseQboProfitAndLossReport(report)
    for (const [acct, amount] of Object.entries(monthly)) {
      totals[acct] = (totals[acct] ?? 0) + amount
    }
  }
  return totals
}

function collectTxnIdsFromParsedRowGroups(
  parsedRowGroups: readonly (readonly { txnId: string | null }[])[],
): string[] {
  const ids = new Set<string>()
  for (const rows of parsedRowGroups) {
    for (const row of rows) {
      if (row.txnId) ids.add(row.txnId)
    }
  }
  return Array.from(ids)
}

function addLineAmountsInto(target: BudgetLineAmounts, source: BudgetLineAmounts) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (value ?? 0)
  }
}

async function getDepartmentLinesForEntity(
  entity: QboEntity,
  department: BudgetDepartmentActualScope,
  start: string,
  end: string,
  mappingRows: readonly BudgetQbMappingRow[],
  transactionPayloadCache: BudgetQboTransactionPayloadCache,
): Promise<{ lines: BudgetLineAmounts; unclassifiedLines: BudgetLineAmounts }> {
  // ONE query per source: P&L totals, account catalog, and ALL GL reports for
  // the entity+range partitioned by account. Previously the GL loader was
  // called per-account inside a serial loop, and each call re-fetched the
  // full result set (the SQL didn't filter on the JSONB account key), making
  // department fan-out 40x slower than necessary.
  const [accountTotals, accountCatalog, glByAccount] = await Promise.all([
    readAggregatedPnlTotals(entity, start, end),
    readCachedAccountCatalogByNumber(entity),
    readCachedGeneralLedgerByAccount<QboGeneralLedgerReport>(entity, start, end),
  ])

  const lines = createEmptyLineAmounts()
  const unclassifiedLines = createEmptyLineAmounts()

  const tasks: DepartmentAccountTask[] = []
  for (const row of mappingRows) {
    for (const account of row.accounts) {
      const accountNumber = String(account)
      const accountTotal = accountTotals[accountNumber] ?? 0
      if (!accountTotal) continue
      tasks.push({
        entity,
        rowKey: row.key,
        accountNumber,
        accountTotal,
        accountId: accountCatalog.get(accountNumber)?.qbAccountId ?? null,
      })
    }
  }

  // Merge per-account GL from the preloaded map, then parse each merged report
  // ONCE. The same parsed rows feed both the txnId collection (for payload
  // preload) and the per-task drill-transaction build. Previously this same
  // JSON was parsed twice per account-task — fine for a single drill, but
  // ~600+ redundant parses per department fetch under All-Entities fan-out.
  const perAccountGl = new Map<string, QboGeneralLedgerReport>()
  const perAccountParsed = new Map<string, readonly ReturnType<typeof parseQboGeneralLedgerRows>[number][]>()
  for (const task of tasks) {
    if (perAccountGl.has(task.accountNumber)) continue
    const reports = glByAccount.get(task.accountNumber) ?? []
    if (reports.length === 0) continue
    const merged = mergeGeneralLedgerReports(reports)
    perAccountGl.set(task.accountNumber, merged)
    perAccountParsed.set(task.accountNumber, parseQboGeneralLedgerRows(merged))
  }

  const txnIds = collectTxnIdsFromParsedRowGroups([...perAccountParsed.values()])
  const payloadMap: Map<string, CachedTransactionPayload<unknown>> = txnIds.length
    ? await readCachedTransactionPayloads(entity, txnIds)
    : new Map()
  const cachedFetcher = buildCachedTransactionPayloadFetcher(payloadMap)

  for (const task of tasks) {
    const perAccountReport = perAccountGl.get(task.accountNumber)
    if (!perAccountReport) continue
    const preParsedRows = perAccountParsed.get(task.accountNumber)

    const ledgerTransactions = task.accountId
      ? await loadBudgetActualLedgerTransactions({
          entity: task.entity,
          accountNumber: task.accountNumber,
          accountName: accountCatalog.get(task.accountNumber)?.qbAccountName ?? null,
          accountId: task.accountId,
          report: perAccountReport,
          transactionPayloadCache,
          fetchTransactionPayload: cachedFetcher,
          // Reuse the entity-wide payload preload so class enrichment doesn't
          // re-query the DB for each task (was ~300+ redundant roundtrips
          // before this hint was wired in).
          preloadedPayloadMap: payloadMap,
          // Skip a second parse of the same JSON — same data, just walked twice.
          preParsedRows,
        })
      : { source: 'gl-report' as const, transactions: [] }

    const allocation = buildBudgetActualScopeAllocation(ledgerTransactions.transactions, task.accountTotal)
    const contribution = getBudgetActualScopeContribution(allocation, department)

    lines[task.rowKey] = (lines[task.rowKey] ?? 0) + contribution.totalUsd
    unclassifiedLines[task.rowKey] = (unclassifiedLines[task.rowKey] ?? 0)
      + allocation.unclassifiedTotalUsd
      + allocation.unresolvedTotalUsd
  }

  return { lines, unclassifiedLines }
}

async function getDepartmentLinesForRange(
  view: BudgetViewState,
  department: BudgetDepartmentActualScope,
  start: string,
  end: string,
  mappingRows: readonly BudgetQbMappingRow[],
  transactionPayloadCache: BudgetQboTransactionPayloadCache,
): Promise<{ lines: BudgetLineAmounts; unclassifiedLines: BudgetLineAmounts }> {
  const entities = getBudgetQboEntities(view.entity)

  // Run all entities in parallel — they read independent DB rows and write to
  // independent accumulators. The merge at the end is pure arithmetic.
  const perEntity = await Promise.all(entities.map((entity) => (
    getDepartmentLinesForEntity(entity, department, start, end, mappingRows, transactionPayloadCache)
  )))

  const lines = createEmptyLineAmounts()
  const unclassifiedLines = createEmptyLineAmounts()
  for (const result of perEntity) {
    addLineAmountsInto(lines, result.lines)
    addLineAmountsInto(unclassifiedLines, result.unclassifiedLines)
  }
  return { lines, unclassifiedLines }
}

export async function fetchBudgetDepartmentActuals(
  view: BudgetViewState,
  department: BudgetDepartmentActualScope,
): Promise<BudgetDepartmentActualsState> {
  const mapping = await loadBudgetQbMappingState(view.year, true)
  const ranges = getBudgetOverviewActualDateRanges(view)
  const transactionPayloadCache: BudgetQboTransactionPayloadCache = new Map()

  // v1-parity short-circuit: per getBudgetOverviewActualDateRanges, the
  // "annual" range is intentionally the same date window as "ytd" (only the
  // BUDGET side of the annual column uses the full-year sum; the ACTUAL side
  // aliases YTD). Computing both means duplicating an entire pass — large GL
  // parse + enrich + allocate — for an identical answer. Detect the alias and
  // reuse the YTD result, saving 33-50% of the request's CPU work.
  const annualSharesYtd =
    ranges.annual.start === ranges.ytd.start && ranges.annual.end === ranges.ytd.end

  const [period, ytd, annual] = annualSharesYtd
    ? await Promise.all([
        getDepartmentLinesForRange(view, department, ranges.period.start, ranges.period.end, mapping.rows, transactionPayloadCache),
        getDepartmentLinesForRange(view, department, ranges.ytd.start, ranges.ytd.end, mapping.rows, transactionPayloadCache),
      ]).then(([p, y]) => [p, y, y] as const)
    : await Promise.all([
        getDepartmentLinesForRange(view, department, ranges.period.start, ranges.period.end, mapping.rows, transactionPayloadCache),
        getDepartmentLinesForRange(view, department, ranges.ytd.start, ranges.ytd.end, mapping.rows, transactionPayloadCache),
        getDepartmentLinesForRange(view, department, ranges.annual.start, ranges.annual.end, mapping.rows, transactionPayloadCache),
      ])

  let lines = composeBudgetActualLineSet({
    period: period.lines,
    ytd: ytd.lines,
    annual: annual.lines,
  })
  const unclassifiedLines = composeBudgetActualLineSet({
    period: period.unclassifiedLines,
    ytd: ytd.unclassifiedLines,
    annual: annual.unclassifiedLines,
  })

  try {
    const revenueLines = await fetchBudgetRevenueLineSet(ranges)
    lines = composeBudgetActualLineSet(lines, revenueLines)
  } catch {
    // Keep department expense actuals even if Opco revenue cannot be loaded.
  }

  return {
    source: 'quickbooks',
    year: view.year,
    view,
    department,
    fetchedAt: new Date().toISOString(),
    mappingSource: mapping.source,
    lines,
    unclassifiedLines,
  }
}
