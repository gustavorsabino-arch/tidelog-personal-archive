import * as fs from 'node:fs'
import * as path from 'node:path'
import * as XLSX from 'xlsx'
import { BUDGET_LINE_ENTRY_BY_KEY } from '../lib/budget/catalog.ts'

const SRC = process.argv[2]
const OUT = process.argv[3]
const MAPPING_CSV = process.argv[4]
if (!SRC || !OUT || !MAPPING_CSV) {
  console.error('usage: bun scripts/fill-coa-mapping.ts <src.xlsx> <out.xlsx> <mapping.csv>')
  process.exit(1)
}

// Load qb_account_number → label from prod CSV + catalog
const mappingByAccount = new Map<string, string>()
const csv = fs.readFileSync(MAPPING_CSV, 'utf8').trim().split('\n').slice(1)
for (const line of csv) {
  const [acct, key] = line.split(',')
  const entry = BUDGET_LINE_ENTRY_BY_KEY[key]
  if (!entry) {
    console.warn(`unknown line_item key for ${acct}: ${key}`)
    continue
  }
  mappingByAccount.set(acct.trim(), entry.label)
}
console.log(`Loaded ${mappingByAccount.size} mapped accounts from prod.`)

const wb = XLSX.readFile(SRC)
const firstSheetName = wb.SheetNames[0]
const ws = wb.Sheets[firstSheetName]

// Header row is row index 1 (zero-based) per inspect. Column E is the 5th
// column (zero-based index 4) in the array form, i.e., spreadsheet column "E".
const ACCT_RE = /^\s*(\d{5})\b/
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (unknown[])[]

let mappedCount = 0
let notMappedCount = 0
let untouchedCount = 0

for (let i = 2; i < rows.length; i++) {
  const row = rows[i]
  if (!row) continue
  // Look for the first 5-digit code in B(1), C(2), D(3)
  let acct: string | null = null
  for (const idx of [1, 2, 3]) {
    const v = row[idx]
    if (typeof v === 'string') {
      const m = v.match(ACCT_RE)
      if (m) {
        acct = m[1]
        break
      }
    }
  }
  if (!acct) {
    untouchedCount++
    continue
  }
  const label = mappingByAccount.get(acct)
  const cellAddr = XLSX.utils.encode_cell({ r: i, c: 6 }) // column G (after Notes/F)
  if (label) {
    ws[cellAddr] = { t: 's', v: label }
    mappedCount++
  } else {
    ws[cellAddr] = { t: 's', v: 'Not Mapped' }
    notMappedCount++
  }
}

// Header for the new column, in the same header row as the others (row index 1)
ws['G2'] = { t: 's', v: 'QB Mapped' }

// Extend !ref to include column G if it doesn't already
const range = XLSX.utils.decode_range(ws['!ref']!)
if (range.e.c < 6) {
  range.e.c = 6
  ws['!ref'] = XLSX.utils.encode_range(range)
}

console.log(`Wrote labels: ${mappedCount} mapped, ${notMappedCount} not mapped, ${untouchedCount} rows skipped (no account code).`)

fs.mkdirSync(path.dirname(OUT), { recursive: true })
XLSX.writeFile(wb, OUT)
console.log(`Saved → ${OUT}`)
