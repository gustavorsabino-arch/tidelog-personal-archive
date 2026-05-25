import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetTabAccess } from '@/lib/budget/access-control'
import { parseBudgetViewFromSearchParams } from '@/lib/budget/api-view'
import { fetchBudgetCoverage } from '@/lib/budget/qb-coverage'
import type { BudgetCoverageAccountEntry, BudgetCoverageStaleMapping } from '@/lib/budget/types'

export const runtime = 'nodejs'

const HEADER = ['section', 'account_number', 'account_name', 'budget_line', 'amount_usd', 'pct_of_total', 'reason']

function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function entryRow(section: string, entry: BudgetCoverageAccountEntry): string {
  return [
    section,
    entry.accountNumber,
    entry.accountName ?? '',
    entry.mappingLine ?? '',
    entry.amountUsd.toFixed(2),
    (entry.pctOfTotal * 100).toFixed(2),
    entry.exclusionReason ?? '',
  ].map(csvEscape).join(',')
}

function staleRow(section: string, row: BudgetCoverageStaleMapping): string {
  return [
    section,
    row.accountNumber,
    row.accountName ?? '',
    row.mappingLine,
    '',
    '',
    row.inCatalog ? '' : 'Account no longer in QB catalog',
  ].map(csvEscape).join(',')
}

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetTabAccess(req, 'coverage')
  if (!accessResult.ok) return accessResult.response

  try {
    const view = parseBudgetViewFromSearchParams(req.nextUrl.searchParams)
    const coverage = await fetchBudgetCoverage(view)

    const lines: string[] = [HEADER.join(',')]
    for (const entry of coverage.mappedAccounts) lines.push(entryRow('mapped', entry))
    for (const entry of coverage.unmappedAccounts) lines.push(entryRow('unmapped', entry))
    for (const entry of coverage.excludedAccounts) lines.push(entryRow('excluded', entry))
    for (const row of coverage.staleMappings) lines.push(staleRow('stale', row))
    for (const row of coverage.orphanedMappings) lines.push(staleRow('orphaned', row))

    const filename = `coverage-${view.entity}-${view.year}-${view.mode}.csv`
    return new NextResponse(lines.join('\n') + '\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('[budget/coverage/export]', error)
    return NextResponse.json({ error: 'Failed to export coverage.' }, { status: 500 })
  }
}
