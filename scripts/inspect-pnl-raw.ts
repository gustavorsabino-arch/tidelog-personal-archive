import { db } from '@/lib/db'
import { qbReportCache } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

const entity = process.argv[2] ?? 'opco'
const periodStart = process.argv[3] ?? '2026-02-01'
const accounts = process.argv.slice(4).length > 0 ? process.argv.slice(4) : ['60310', '60410']

const [row] = await db
  .select()
  .from(qbReportCache)
  .where(and(
    eq(qbReportCache.entityId, entity),
    eq(qbReportCache.reportType, 'profit_and_loss'),
    eq(qbReportCache.periodStart, periodStart),
  ))
  .limit(1)

if (!row) {
  console.error('no cached P&L row')
  process.exit(1)
}

const raw = JSON.stringify(row.data)

for (const code of accounts) {
  let i = 0
  let count = 0
  console.log(`\n=== ${code} ===`)
  while (true) {
    const found = raw.indexOf(code, i)
    if (found === -1) break
    count++
    console.log(`occurrence ${count}: ...${raw.slice(Math.max(0, found - 20), found + 200)}...`)
    i = found + code.length
  }
  console.log(`--- total: ${count} occurrence(s)`)
}

process.exit(0)
