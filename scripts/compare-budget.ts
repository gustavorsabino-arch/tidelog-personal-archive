import { db } from '@/lib/db'
import { qbReportCache } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { parsePnlReport, type PnlAccount, type PnlSection } from '@/lib/qb/pnl'
import { DEFAULT_BUDGET_QB_MAPPING_ROWS } from '@/lib/budget/qb-mapping'
import { BUDGET_ENTITIES } from '@/lib/constants'

const periodStart = process.argv[2] ?? '2026-02-01'
const periodEnd = process.argv[3] ?? '2026-02-28'
// Budget view intentionally excludes Juku — match that scope here.
const entities = BUDGET_ENTITIES.map((e) => e.toLowerCase())

type AccountTotals = Record<string, number>

function flatten(sections: PnlSection[]): AccountTotals {
  const out: AccountTotals = {}
  function walk(nodes: Array<PnlSection | PnlAccount>) {
    for (const node of nodes) {
      if (node.kind === 'section') walk(node.children)
      else if (node.glCode) out[node.glCode] = (out[node.glCode] ?? 0) + node.amount
    }
  }
  walk(sections)
  return out
}

const perEntity: Record<string, AccountTotals> = {}
for (const entity of entities) {
  const [row] = await db
    .select()
    .from(qbReportCache)
    .where(and(
      eq(qbReportCache.entityId, entity),
      eq(qbReportCache.reportType, 'profit_and_loss'),
      eq(qbReportCache.periodStart, periodStart),
      eq(qbReportCache.periodEnd, periodEnd),
    ))
    .limit(1)

  if (!row) {
    console.error(`[warn] no cached P&L for ${entity} ${periodStart}..${periodEnd}`)
    perEntity[entity] = {}
    continue
  }
  const tree = parsePnlReport(row.data as never)
  perEntity[entity] = flatten(tree.sections)
}

console.log(`Budget actuals for ${periodStart}..${periodEnd} (scope: ${BUDGET_ENTITIES.join(', ')})`)
console.log(['Line Item', 'Accounts', ...BUDGET_ENTITIES, 'Total'].join(','))
for (const mapping of DEFAULT_BUDGET_QB_MAPPING_ROWS) {
  const row: number[] = []
  let total = 0
  for (const entity of entities) {
    let entitySum = 0
    for (const account of mapping.accounts) {
      entitySum += perEntity[entity][String(account)] ?? 0
    }
    row.push(entitySum)
    total += entitySum
  }
  const accounts = mapping.accounts.join('+')
  console.log([mapping.line, accounts, ...row.map((n) => n.toFixed(2)), total.toFixed(2)].join(','))
}

process.exit(0)
