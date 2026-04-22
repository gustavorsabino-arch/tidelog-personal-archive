import { db } from '@/lib/db'
import { qbReportCache } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { parsePnlReport, type PnlAccount, type PnlSection } from '@/lib/qb/pnl'

const entity = process.argv[2] ?? 'opco'
const periodStart = process.argv[3] ?? '2026-02-01'
const periodEnd = process.argv[4] ?? '2026-02-28'

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
  console.error(`no cached P&L for ${entity} ${periodStart}..${periodEnd}`)
  process.exit(1)
}

const tree = parsePnlReport(row.data as never)

function walk(nodes: Array<PnlSection | PnlAccount>, section: string) {
  for (const node of nodes) {
    if (node.kind === 'section') {
      walk(node.children, node.title)
      continue
    }
    const cleanLabel = node.label.replace(/^\d+\s*·?\s*/, '').replace(/"/g, '""')
    console.log([section, node.glCode ?? '', `"${cleanLabel}"`, node.amount].join(','))
  }
}

console.log('Section,GLCode,Account,Total')
for (const section of tree.sections) walk(section.children, section.title)

console.log('---')
console.log(`Revenue: ${tree.totals.revenue}`)
console.log(`Expense: ${tree.totals.expense}`)
console.log(`OtherIncome: ${tree.totals.otherIncome}`)
console.log(`OtherExpense: ${tree.totals.otherExpense}`)
console.log(`NetIncome: ${tree.totals.netIncome}`)

process.exit(0)
