import 'server-only'

import { BUDGET_DEPTS } from '../constants.ts'
import { fetchQboJson } from '@/lib/qb/client'
import { BUDGET_QBO_ENTITIES, getQboRealmId, type QboEntity } from '@/lib/qb/config'

import {
  getBudgetOverviewActualDateRanges,
  parseQboGeneralLedgerByClass,
  parseQboProfitAndLossReport,
  type QboGeneralLedgerReport,
  type QboProfitAndLossReport,
} from './actuals.ts'
import { normalizeBudgetQboClassName } from './qb-class.ts'
import { loadBudgetQbMappingState } from './qb-mapping.ts'
import type { BudgetHeadcountActualEntry, BudgetHeadcountActualsState, BudgetQbMappingRow, BudgetViewState } from './types.ts'

type QboAccountQueryResponse = {
  QueryResponse?: {
    Account?: Array<{
      Id?: string
      AcctNum?: string
      Name?: string
    }>
  }
}

type CompensationLineKey = 'salary' | 'bonus'
type AccountIdMap = Record<string, string>
type HeadcountTask = {
  lineKey: CompensationLineKey
  entity: QboEntity
  accountNumber: string
  accountTotal: number
  accountId?: string
}

const HEADCOUNT_LINE_KEYS = new Set<CompensationLineKey>(['salary', 'bonus'])
const HEADCOUNT_GL_CONCURRENCY = 2

function getBudgetQboEntities(entity: BudgetViewState['entity']): QboEntity[] {
  if (entity === 'All') return [...BUDGET_QBO_ENTITIES]
  return [entity]
}

function buildQueryPath(entity: QboEntity, query: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=65`
}

function buildGeneralLedgerPath(entity: QboEntity, start: string, end: string, accountId: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/reports/GeneralLedger?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&account=${encodeURIComponent(accountId)}&columns=tx_date,txn_type,doc_num,name,klass_name,memo,subt_nat_amount,rbal_nat_amount&accounting_method=Accrual&minorversion=65`
}

function buildProfitAndLossPath(entity: QboEntity, start: string, end: string): string {
  const realmId = getQboRealmId(entity)
  return `/v3/company/${encodeURIComponent(realmId)}/reports/ProfitAndLoss?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&accounting_method=Accrual&minorversion=65`
}

function buildAccountIdMap(response: QboAccountQueryResponse): AccountIdMap {
  const accounts = response.QueryResponse?.Account ?? []
  const result: AccountIdMap = {}

  for (const account of accounts) {
    const id = String(account.Id ?? '').trim()
    if (!id) continue

    const accountNumber = String(account.AcctNum ?? '').trim()
    if (accountNumber) {
      result[accountNumber] = id
      continue
    }

    const name = String(account.Name ?? '')
    const match = name.match(/^(\d{4,6})\s/)
    if (match) {
      result[match[1]] = id
    }
  }

  return result
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length || 1)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      await worker(item)
    }
  })

  await Promise.all(workers)
}

async function fetchAccountIdMap(
  entity: QboEntity,
  cache: Map<string, Promise<AccountIdMap>>,
): Promise<AccountIdMap> {
  const cached = cache.get(entity)
  if (cached) return cached

  const promise = fetchQboJson<QboAccountQueryResponse>(
    entity,
    buildQueryPath(entity, 'SELECT * FROM Account MAXRESULTS 1000'),
  ).then(buildAccountIdMap)

  cache.set(entity, promise)
  return promise
}

async function fetchProfitAndLossReport(
  entity: QboEntity,
  start: string,
  end: string,
  cache: Map<string, Promise<QboProfitAndLossReport>>,
): Promise<QboProfitAndLossReport> {
  const key = `${entity}:${start}:${end}`
  const cached = cache.get(key)
  if (cached) return cached

  const promise = fetchQboJson<QboProfitAndLossReport>(entity, buildProfitAndLossPath(entity, start, end))
  cache.set(key, promise)
  return promise
}

async function fetchGeneralLedgerReport(
  entity: QboEntity,
  start: string,
  end: string,
  accountId: string,
  cache: Map<string, Promise<QboGeneralLedgerReport>>,
): Promise<QboGeneralLedgerReport> {
  const key = `${entity}:${accountId}:${start}:${end}`
  const cached = cache.get(key)
  if (cached) return cached

  const promise = fetchQboJson<QboGeneralLedgerReport>(entity, buildGeneralLedgerPath(entity, start, end, accountId))
  cache.set(key, promise)
  return promise
}

function buildHeadcountTasks(
  entities: readonly QboEntity[],
  accountTotalsByEntity: Record<string, Record<string, number>>,
  accountIdMapsByEntity: Record<string, AccountIdMap>,
  mappingRows: readonly BudgetQbMappingRow[],
): HeadcountTask[] {
  const tasks: HeadcountTask[] = []

  for (const row of mappingRows) {
    if (!HEADCOUNT_LINE_KEYS.has(row.key as CompensationLineKey)) continue
    const lineKey = row.key as CompensationLineKey

    for (const entity of entities) {
      const accountTotals = accountTotalsByEntity[entity] ?? {}
      const accountIdMap = accountIdMapsByEntity[entity] ?? {}

      for (const account of row.accounts) {
        const accountNumber = String(account)
        const accountTotal = accountTotals[accountNumber] ?? 0
        if (!accountTotal) continue

        tasks.push({
          lineKey,
          entity,
          accountNumber,
          accountTotal,
          accountId: accountIdMap[accountNumber],
        })
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
  const accountMapCache = new Map<string, Promise<AccountIdMap>>()
  const pnlCache = new Map<string, Promise<QboProfitAndLossReport>>()
  const glCache = new Map<string, Promise<QboGeneralLedgerReport>>()

  const accountMaps = await Promise.all(
    entities.map(async (entity) => [entity, await fetchAccountIdMap(entity, accountMapCache)] as const),
  )
  const pnlReports = await Promise.all(
    entities.map(async (entity) => [entity, await fetchProfitAndLossReport(entity, range.start, range.end, pnlCache)] as const),
  )

  const accountTotalsByEntity = Object.fromEntries(
    pnlReports.map(([entity, report]) => [entity, parseQboProfitAndLossReport(report)]),
  ) as Record<string, Record<string, number>>
  const accountIdMapsByEntity = Object.fromEntries(accountMaps) as Record<string, AccountIdMap>

  const byDepartment = Object.fromEntries(
    BUDGET_DEPTS.map((department) => [department, { salaryActualUsd: 0, bonusActualUsd: 0 }]),
  ) as Record<string, { salaryActualUsd: number; bonusActualUsd: number }>
  let unclassifiedSalaryUsd = 0
  let unclassifiedBonusUsd = 0

  const tasks = buildHeadcountTasks(entities, accountTotalsByEntity, accountIdMapsByEntity, mapping.rows)

  await runWithConcurrency(tasks, HEADCOUNT_GL_CONCURRENCY, async (task) => {
    if (!task.accountId) {
      if (task.lineKey === 'salary') {
        unclassifiedSalaryUsd += task.accountTotal
      } else {
        unclassifiedBonusUsd += task.accountTotal
      }
      return
    }

    const glReport = await fetchGeneralLedgerReport(task.entity, range.start, range.end, task.accountId, glCache)
    const glTotals = parseQboGeneralLedgerByClass(glReport)
    let assigned = 0

    for (const [rawClass, amount] of Object.entries(glTotals.classified)) {
      const department = normalizeBudgetQboClassName(rawClass)
      if (department) {
        if (task.lineKey === 'salary') {
          byDepartment[department].salaryActualUsd += amount
        } else {
          byDepartment[department].bonusActualUsd += amount
        }
      } else if (task.lineKey === 'salary') {
        unclassifiedSalaryUsd += amount
      } else {
        unclassifiedBonusUsd += amount
      }
      assigned += amount
    }

    if (glTotals.unclassified !== 0) {
      if (task.lineKey === 'salary') {
        unclassifiedSalaryUsd += glTotals.unclassified
      } else {
        unclassifiedBonusUsd += glTotals.unclassified
      }
      assigned += glTotals.unclassified
    }

    const remainder = task.accountTotal - assigned
    if (Math.abs(remainder) > 0.005) {
      if (task.lineKey === 'salary') {
        unclassifiedSalaryUsd += remainder
      } else {
        unclassifiedBonusUsd += remainder
      }
    }
  })

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
