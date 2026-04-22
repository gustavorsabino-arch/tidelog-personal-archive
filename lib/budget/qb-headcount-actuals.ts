import { BUDGET_DEPTS } from '../constants.ts'
import {
  readCachedAccountCatalogByNumber,
  readCachedGeneralLedgerForAccount,
  readCachedReportsInRange,
} from '@/lib/qb/cache-reads'
import { BUDGET_QBO_ENTITIES, type QboEntity } from '@/lib/qb/config'

import {
  getBudgetOverviewActualDateRanges,
  mergeGeneralLedgerReports,
  parseQboGeneralLedgerByClass,
  parseQboProfitAndLossReport,
  type QboGeneralLedgerReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { normalizeBudgetQboClassName } from './qb-class.ts'
import { loadBudgetQbMappingState } from './qb-mapping-db.ts'
import type { BudgetHeadcountActualEntry, BudgetHeadcountActualsState, BudgetQbMappingRow, BudgetViewState } from './types.ts'

type CompensationLineKey = 'salary' | 'bonus'
type HeadcountTask = {
  lineKey: CompensationLineKey
  entity: QboEntity
  accountNumber: string
  accountTotal: number
}

const HEADCOUNT_LINE_KEYS = new Set<CompensationLineKey>(['salary', 'bonus'])

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
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

function buildHeadcountTasks(
  entities: readonly QboEntity[],
  accountTotalsByEntity: Record<string, Record<string, number>>,
  mappingRows: readonly BudgetQbMappingRow[],
): HeadcountTask[] {
  const tasks: HeadcountTask[] = []

  for (const row of mappingRows) {
    if (!HEADCOUNT_LINE_KEYS.has(row.key as CompensationLineKey)) continue
    const lineKey = row.key as CompensationLineKey

    for (const entity of entities) {
      const accountTotals = accountTotalsByEntity[entity] ?? {}

      for (const account of row.accounts) {
        const accountNumber = String(account)
        const accountTotal = accountTotals[accountNumber] ?? 0
        if (!accountTotal) continue

        tasks.push({ lineKey, entity, accountNumber, accountTotal })
      }
    }
  }

  return tasks
}

export async function fetchBudgetHeadcountActuals(view: BudgetViewState): Promise<BudgetHeadcountActualsState> {
  const mapping = await loadBudgetQbMappingState(view.year, true)
  const entities = getBudgetQboEntities(view.entity)
  const ranges = getBudgetOverviewActualDateRanges(view)
  const range = view.mode === 'ytd' ? ranges.ytd : ranges.period

  const perEntity = await Promise.all(entities.map(async (entity) => {
    const [totals, catalog] = await Promise.all([
      readAggregatedPnlTotals(entity, range.start, range.end),
      readCachedAccountCatalogByNumber(entity),
    ])
    return { entity, totals, catalog }
  }))

  const accountTotalsByEntity: Record<string, Record<string, number>> = {}
  const catalogByEntity = new Map<QboEntity, Map<string, { qbAccountId: string }>>()
  for (const { entity, totals, catalog } of perEntity) {
    accountTotalsByEntity[entity] = totals
    catalogByEntity.set(entity, new Map(Array.from(catalog).map(([n, v]) => [n, { qbAccountId: v.qbAccountId }])))
  }

  // Per-account GL loaded lazily as tasks request them, so we don't pull
  // accounts the mapping doesn't reference.
  const glCache = new Map<string, Promise<QboGeneralLedgerReport | null>>()
  async function loadAccountGl(entity: QboEntity, accountNumber: string): Promise<QboGeneralLedgerReport | null> {
    const key = `${entity}:${accountNumber}`
    const cached = glCache.get(key)
    if (cached) return cached
    const promise = readCachedGeneralLedgerForAccount<QboGeneralLedgerReport>(entity, accountNumber, range.start, range.end)
      .then((reports) => reports.length ? mergeGeneralLedgerReports(reports) : null)
    glCache.set(key, promise)
    return promise
  }

  const byDepartment = Object.fromEntries(
    BUDGET_DEPTS.map((department) => [department, { salaryActualUsd: 0, bonusActualUsd: 0 }]),
  ) as Record<string, { salaryActualUsd: number; bonusActualUsd: number }>
  let unclassifiedSalaryUsd = 0
  let unclassifiedBonusUsd = 0

  const tasks = buildHeadcountTasks(entities, accountTotalsByEntity, mapping.rows)

  for (const task of tasks) {
    const hasCatalogMatch = catalogByEntity.get(task.entity)?.has(task.accountNumber) ?? false
    const perAccountReport = hasCatalogMatch ? await loadAccountGl(task.entity, task.accountNumber) : null

    if (!hasCatalogMatch || !perAccountReport) {
      // No cached GL or no account-id mapping — drop the whole amount into unclassified.
      if (task.lineKey === 'salary') unclassifiedSalaryUsd += task.accountTotal
      else unclassifiedBonusUsd += task.accountTotal
      continue
    }

    const glTotals = parseQboGeneralLedgerByClass(perAccountReport)
    let assigned = 0

    for (const [rawClass, amount] of Object.entries(glTotals.classified)) {
      const department = normalizeBudgetQboClassName(rawClass)
      if (department) {
        if (task.lineKey === 'salary') byDepartment[department].salaryActualUsd += amount
        else byDepartment[department].bonusActualUsd += amount
      } else if (task.lineKey === 'salary') {
        unclassifiedSalaryUsd += amount
      } else {
        unclassifiedBonusUsd += amount
      }
      assigned += amount
    }

    if (glTotals.unclassified !== 0) {
      if (task.lineKey === 'salary') unclassifiedSalaryUsd += glTotals.unclassified
      else unclassifiedBonusUsd += glTotals.unclassified
      assigned += glTotals.unclassified
    }

    const remainder = task.accountTotal - assigned
    if (Math.abs(remainder) > 0.005) {
      if (task.lineKey === 'salary') unclassifiedSalaryUsd += remainder
      else unclassifiedBonusUsd += remainder
    }
  }

  const departments: BudgetHeadcountActualEntry[] = BUDGET_DEPTS.map((dept) => ({
    dept,
    salaryActualUsd: byDepartment[dept].salaryActualUsd,
    bonusActualUsd: byDepartment[dept].bonusActualUsd,
    totalActualUsd: byDepartment[dept].salaryActualUsd + byDepartment[dept].bonusActualUsd,
  }))

  return {
    source: 'quickbooks',
    year: view.year,
    view,
    fetchedAt: new Date().toISOString(),
    mappingSource: mapping.source,
    departments,
    unclassifiedSalaryUsd,
    unclassifiedBonusUsd,
    unclassifiedTotalUsd: unclassifiedSalaryUsd + unclassifiedBonusUsd,
  }
}
