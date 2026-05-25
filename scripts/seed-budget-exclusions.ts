/**
 * One-shot seed: import exclusions from the Chart of Accounts xlsx.
 * Rows where Notes (column F) equals "Do not map to budget" become exclusions.
 *
 * Usage:
 *   bun scripts/seed-budget-exclusions.ts "$HOME/Downloads/Chart of Accounts (1).xlsx" [--dry]
 *
 * Idempotent — uses ON CONFLICT DO NOTHING so re-runs do not change existing rows.
 * Skips any account that is currently mapped (Option C invariant).
 */
import * as XLSX from 'xlsx'

import { db } from '@/lib/db'
import { budgetQbMapping, budgetQbMappingExclusion } from '@/lib/db/schema/budget'
import { inArray } from 'drizzle-orm'

const ACCT_RE = /^\s*(\d{5})\b/
const DEFAULT_REASON = 'Do not map to budget (per Chart of Accounts)'

async function main() {
  const path = process.argv[2]
  const dry = process.argv.includes('--dry')
  if (!path) {
    console.error('usage: bun scripts/seed-budget-exclusions.ts <xlsx-path> [--dry]')
    process.exit(1)
  }

  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]

  // Sheet ref starts at column B, so array index 0 = column B. Verified
  // against the live xlsx earlier (see scripts/fill-coa-mapping.ts).
  const COL_B = 0
  const COL_C = 1
  const COL_D = 2
  const COL_F = 4

  const candidates = new Set<string>()
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const notes = typeof row[COL_F] === 'string' ? (row[COL_F] as string).trim() : ''
    if (notes !== 'Do not map to budget') continue
    let acct: string | null = null
    for (const idx of [COL_B, COL_C, COL_D]) {
      const v = row[idx]
      if (typeof v === 'string') {
        const m = v.match(ACCT_RE)
        if (m) { acct = m[1]; break }
      }
    }
    if (acct) candidates.add(acct)
  }

  if (candidates.size === 0) {
    console.log('No "Do not map to budget" rows found.')
    return
  }

  const candidatesArray = Array.from(candidates).sort()
  console.log(`Found ${candidatesArray.length} candidate exclusions.`)

  // Skip any account that is currently mapped (Option C invariant).
  const mappedRows = await db
    .select({ qbAccountNumber: budgetQbMapping.qbAccountNumber })
    .from(budgetQbMapping)
    .where(inArray(budgetQbMapping.qbAccountNumber, candidatesArray))
  const mappedSet = new Set(mappedRows.map((row) => row.qbAccountNumber))
  if (mappedSet.size > 0) {
    console.warn(`Skipping ${mappedSet.size} accounts that are currently mapped:`, Array.from(mappedSet).sort())
  }

  const insertValues = candidatesArray
    .filter((acct) => !mappedSet.has(acct))
    .map((acct) => ({ qbAccountNumber: acct, reason: DEFAULT_REASON, updatedAt: new Date() }))

  if (insertValues.length === 0) {
    console.log('Nothing to insert after conflict filtering.')
    return
  }

  if (dry) {
    console.log(`[dry-run] would insert ${insertValues.length} rows:`)
    insertValues.forEach((row) => console.log(' ', row.qbAccountNumber))
    return
  }

  await db
    .insert(budgetQbMappingExclusion)
    .values(insertValues)
    .onConflictDoNothing({ target: budgetQbMappingExclusion.qbAccountNumber })

  console.log(`Inserted (or skipped existing) ${insertValues.length} exclusion rows.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
