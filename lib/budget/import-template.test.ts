import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'

import { buildBudgetImportTemplateRows, TEMPLATE_MONTH_HEADERS } from './import-template.ts'
import { parseBudgetWorkbook } from './import.ts'

test('template rows carry all 12 month headers and known line-item labels', () => {
  const rows = buildBudgetImportTemplateRows()
  const header = rows[0]
  assert.deepEqual(header.slice(3), TEMPLATE_MONTH_HEADERS)
  const labels = rows.map((r) => r[2]).filter(Boolean)
  assert.ok(labels.includes('Company Tools'))
  assert.ok(labels.includes('Department Tools'))
  assert.ok(labels.includes('Cloud Hosting & Compute'))
})

test('a filled template round-trips through parseBudgetWorkbook to the right keys/months', () => {
  const rows = buildBudgetImportTemplateRows().map((r) => [...r])
  // Fill Oct/Nov/Dec (columns 12,13,14 = indices for Oct,Nov,Dec) for two lines.
  const octIdx = 3 + TEMPLATE_MONTH_HEADERS.indexOf('Oct')
  const novIdx = 3 + TEMPLATE_MONTH_HEADERS.indexOf('Nov')
  const decIdx = 3 + TEMPLATE_MONTH_HEADERS.indexOf('Dec')
  for (const r of rows) {
    if (r[2] === 'Company Tools') { r[octIdx] = 100; r[novIdx] = 200; r[decIdx] = 300 }
    if (r[2] === 'Cloud Hosting & Compute') { r[octIdx] = 10; r[novIdx] = 20; r[decIdx] = 30 }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Engineering')
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

  const parsed = parseBudgetWorkbook(buffer, 'Engineering', 'annual')
  assert.equal(parsed.invalidSheets.length, 0)
  const dept = parsed.departments[0]
  assert.ok(dept)
  assert.equal(dept?.periods['10']?.bizTools, 100)
  assert.equal(dept?.periods['11']?.bizTools, 200)
  assert.equal(dept?.periods['12']?.bizTools, 300)
  assert.equal(dept?.periods['10']?.hosting, 10)
})
