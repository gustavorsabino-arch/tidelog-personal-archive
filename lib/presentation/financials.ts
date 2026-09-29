import { mergePnlTrees, parsePnlReport, type PnlSection, type PnlTree, type QboProfitAndLossReport } from '@/lib/qb/pnl'
import { ENTITIES } from '@/lib/constants'
import type { QboEntity } from '@/lib/qb/config'
import { inventoryPnlTree, type PnlInventory } from '@/lib/report/pnl-inventory'

export type FinancialTotals = PnlTree['totals']
export type FinancialLine = { key: string; label: string; kind: PnlSection['sectionKind']; amount: number; depth: number }
export type FinancialMonth = {
  month: number
  entity: QboEntity | 'All'
  totals: FinancialTotals
  lines: FinancialLine[]
  presentEntities: QboEntity[]
  inventory: PnlInventory
}
export type PresentationFinancials = { year: number; months: FinancialMonth[] }
export type CachedPnlMonth = { entity: QboEntity; periodStart: string; data: QboProfitAndLossReport }

const EMPTY_TOTALS: FinancialTotals = { revenue: 0, expense: 0, otherIncome: 0, otherExpense: 0, netIncome: 0 }

function toLines(sections: readonly PnlSection[]): FinancialLine[] {
  const lines: FinancialLine[] = []
  function visit(section: PnlSection, path: string, depth: number) {
    const key = `${path}/${section.sectionKind}:${section.title}`
    lines.push({ key, label: section.title, kind: section.sectionKind, amount: section.total, depth })
    for (const child of section.children) {
      if (child.kind === 'section') visit(child, key, depth + 1)
      else lines.push({ key: `${key}/account:${child.glCode ?? child.label}`, label: child.label, kind: section.sectionKind, amount: child.amount, depth: depth + 1 })
    }
  }
  for (const section of sections) visit(section, '', 0)
  return lines
}

export function buildPresentationFinancials(year: number, reports: readonly CachedPnlMonth[]): PresentationFinancials {
  const byMonth = new Map<number, Map<QboEntity, PnlTree>>()
  for (const report of reports) {
    const date = report.periodStart.match(/^(\d{4})-(\d{2})-01$/)
    if (!date || Number(date[1]) !== year) continue
    const month = Number(date[2])
    if (month < 1 || month > 12) continue
    const entities = byMonth.get(month) ?? new Map<QboEntity, PnlTree>()
    entities.set(report.entity, parsePnlReport(report.data))
    byMonth.set(month, entities)
  }

  const months: FinancialMonth[] = []
  for (let month = 1; month <= 12; month++) {
    const entities = byMonth.get(month) ?? new Map<QboEntity, PnlTree>()
    const presentEntities = ENTITIES.filter((entity) => entities.has(entity))
    for (const entity of presentEntities) {
      const tree = entities.get(entity)!
      months.push({ month, entity, totals: tree.totals, lines: toLines(tree.sections), presentEntities: [entity], inventory: inventoryPnlTree(tree) })
    }
    if (presentEntities.length > 0) {
      const group = mergePnlTrees(presentEntities.map((entity) => entities.get(entity)!))
      months.push({ month, entity: 'All', totals: group.totals, lines: toLines(group.sections), presentEntities, inventory: inventoryPnlTree(group) })
    }
  }
  return { year, months }
}

export function getFinancialMonth(data: PresentationFinancials, entity: FinancialMonth['entity'], month: number): FinancialMonth | null {
  return data.months.find((row) => row.entity === entity && row.month === month) ?? null
}

export function getMonthComparison(data: PresentationFinancials, entity: FinancialMonth['entity'], monthA: number, monthB: number) {
  const a = getFinancialMonth(data, entity, monthA)
  const b = getFinancialMonth(data, entity, monthB)
  const keys = new Map<string, { key: string; label: string; kind: FinancialLine['kind']; depth: number; a: number; b: number }>()
  for (const line of a?.lines ?? []) keys.set(line.key, { key: line.key, label: line.label, kind: line.kind, depth: line.depth, a: line.amount, b: 0 })
  for (const line of b?.lines ?? []) {
    const existing = keys.get(line.key)
    if (existing) existing.b = line.amount
    else keys.set(line.key, { key: line.key, label: line.label, kind: line.kind, depth: line.depth, a: 0, b: line.amount })
  }
  return { a, b, lines: [...keys.values()], complete: !!a && !!b && (entity !== 'All' || (a.presentEntities.length === ENTITIES.length && b.presentEntities.length === ENTITIES.length)) }
}

export function getYtdTrend(data: PresentationFinancials, entity: FinancialMonth['entity'], throughMonth: number) {
  const rows = Array.from({ length: throughMonth }, (_, i) => getFinancialMonth(data, entity, i + 1))
  const complete = rows.every(Boolean) && (entity !== 'All' || rows.every((row) => row?.presentEntities.length === ENTITIES.length))
  const ytd = rows.reduce<FinancialTotals>((sum, row) => {
    if (!row) return sum
    return {
      revenue: sum.revenue + row.totals.revenue,
      expense: sum.expense + row.totals.expense,
      otherIncome: sum.otherIncome + row.totals.otherIncome,
      otherExpense: sum.otherExpense + row.totals.otherExpense,
      netIncome: sum.netIncome + row.totals.netIncome,
    }
  }, { ...EMPTY_TOTALS })
  return { rows, ytd, complete }
}

export function getYtdSummary(data: PresentationFinancials | undefined, entity: FinancialMonth['entity'], throughMonth: number) {
  const rows = Array.from({ length: throughMonth }, (_, index) => data ? getFinancialMonth(data, entity, index + 1) : null)
  const present = rows.filter((row): row is FinancialMonth => row !== null)
  const totals = present.reduce<FinancialTotals>((sum, row) => ({
    revenue: sum.revenue + row.totals.revenue,
    expense: sum.expense + row.totals.expense,
    otherIncome: sum.otherIncome + row.totals.otherIncome,
    otherExpense: sum.otherExpense + row.totals.otherExpense,
    netIncome: sum.netIncome + row.totals.netIncome,
  }), { ...EMPTY_TOTALS })
  const groups = new Map<string, { kind: PnlInventory['groups'][number]['kind']; group: PnlInventory['groups'][number]['group']; amount: number }>()
  for (const row of present) for (const item of row.inventory.groups) {
    const key = `${item.kind}|${item.group}`
    const current = groups.get(key)
    if (current) current.amount = (Math.round(current.amount * 100) + Math.round(item.amount * 100)) / 100
    else groups.set(key, { ...item })
  }
  return {
    totals,
    groups: [...groups.values()],
    months: present.length,
    complete: present.length === throughMonth && (entity !== 'All' || present.every((row) => row.presentEntities.length === ENTITIES.length)),
    missingMonths: rows.flatMap((row, index) => row ? [] : [index + 1]),
    presentEntities: [...new Set(present.flatMap((row) => row.presentEntities))],
  }
}
