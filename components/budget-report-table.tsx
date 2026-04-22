'use client'

import { fmtUSD } from '@/lib/format'
import { canOpenBudgetActualDrill, canOpenBudgetPlanBreakdown } from '@/lib/budget/drill'
import type { BudgetReportColumnKey, BudgetReportRow, BudgetReportTableModel } from '@/lib/budget/types'

type BudgetReportTableProps = {
  report: BudgetReportTableModel
  onBudgetCellClick?: (row: BudgetReportRow, column: BudgetReportColumnKey) => void
  onActualCellClick?: (row: BudgetReportRow, column: BudgetReportColumnKey) => void
}

function formatBudgetCell(value: number | null): string {
  if (value === null || value === 0) return '—'
  return fmtUSD(value, 0)
}

function formatActualCell(value: number | null): string {
  if (value === null || value === 0) return '—'
  return fmtUSD(value, 0)
}

function formatVarianceCell(value: number | null): string {
  if (value === null || value === 0) return '—'
  return `${value > 0 ? '+' : '-'}${fmtUSD(Math.abs(value), 0)}`
}

function varianceTone(budgetUsd: number | null, actualUsd: number | null): 'zero' | 'under' | 'warn' | 'over' {
  const budget = budgetUsd ?? 0
  const actual = actualUsd ?? 0

  if (budget === 0 && actual === 0) return 'zero'
  if (budget === 0 && actual > 0) return 'over'
  if (actual <= budget) return 'under'

  return (actual - budget) / budget > 0.15 ? 'over' : 'warn'
}

function renderCellButton(
  value: string,
  clickable: boolean,
  onClick: (() => void) | undefined,
  tone?: string,
) {
  if (!clickable || !onClick) return value

  return (
    <button
      type="button"
      className={`budget-table-cell-button${tone ? ` ${tone}` : ''}`}
      onClick={onClick}
    >
      {value}
    </button>
  )
}

export function BudgetReportTable({ report, onBudgetCellClick, onActualCellClick }: BudgetReportTableProps) {
  return (
    <div className="section">
      <div className="section-header">
        <div>
          <span
            className="section-title"
            style={{ fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.2, display: 'block' }}
          >
            {report.title}
          </span>
          {report.subtitle ? <div className="budget-section-note" style={{ marginTop: 4 }}>{report.subtitle}</div> : null}
        </div>
        {report.helperText ? <span className="budget-section-note">{report.helperText}</span> : null}
      </div>

      <div className="table-wrap budget-report-table-wrap">
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Line Item</th>
              <th colSpan={3} className="budget-report-group-header">{report.periodLabel}</th>
              <th className="budget-table-divider" rowSpan={2} />
              <th colSpan={3} className="budget-report-group-header">{report.ytdLabel}</th>
              <th className="budget-table-divider" rowSpan={2} />
              <th colSpan={3} className="budget-report-group-header">{report.annualLabel}</th>
            </tr>
            <tr>
              <th className="num">Budget</th>
              <th className="num">Actual</th>
              <th className="num">Var</th>
              <th className="num">Budget</th>
              <th className="num">Actual</th>
              <th className="num">Var</th>
              <th className="num">Budget</th>
              <th className="num">Actual</th>
              <th className="num">Var</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              if (row.kind === 'category') {
                return (
                  <tr
                    key={row.key}
                    className={`budget-report-category-row${row.tone === 'revenue' ? ' budget-report-category-row-revenue' : ''}`}
                  >
                    <td colSpan={12}>{row.label}</td>
                  </tr>
                )
              }

              const periodTone = varianceTone(row.cells.period.budgetUsd, row.cells.period.actualUsd)
              const ytdTone = varianceTone(row.cells.ytd.budgetUsd, row.cells.ytd.actualUsd)
              const annualTone = varianceTone(row.cells.annual.budgetUsd, row.cells.annual.actualUsd)
              const periodBudgetClickable = canOpenBudgetPlanBreakdown(row, 'period')
              const periodActualClickable = canOpenBudgetActualDrill(row, 'period', report)
              const ytdActualClickable = canOpenBudgetActualDrill(row, 'ytd', report)

              return (
                <tr
                  key={row.key}
                  className={[
                    row.kind === 'total' ? 'budget-report-total-row' : '',
                    row.tone === 'grand-total' ? 'budget-report-grand-total-row' : '',
                    row.tone === 'revenue' ? 'budget-report-revenue-row' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <td className={row.kind === 'line' ? 'label budget-report-indent' : 'label'}>{row.label}</td>
                  <td className="num">
                    {renderCellButton(
                      formatBudgetCell(row.cells.period.budgetUsd),
                      periodBudgetClickable,
                      onBudgetCellClick ? () => onBudgetCellClick(row, 'period') : undefined,
                    )}
                  </td>
                  <td className="num" style={{ color: row.tone === 'revenue' ? '#04a776' : 'var(--muted)' }}>
                    {renderCellButton(
                      formatActualCell(row.cells.period.actualUsd),
                      periodActualClickable,
                      onActualCellClick ? () => onActualCellClick(row, 'period') : undefined,
                      row.tone === 'revenue' ? 'revenue' : undefined,
                    )}
                  </td>
                  <td className="num">
                    <span className={`budget-variance-chip budget-variance-${periodTone}`}>{formatVarianceCell(row.cells.period.varianceUsd)}</span>
                  </td>
                  <td className="budget-table-divider" />
                  <td className="num">
                    {renderCellButton(
                      formatBudgetCell(row.cells.ytd.budgetUsd),
                      false,
                      onBudgetCellClick ? () => onBudgetCellClick(row, 'ytd') : undefined,
                    )}
                  </td>
                  <td className="num" style={{ color: row.tone === 'revenue' ? '#04a776' : 'var(--muted)' }}>
                    {renderCellButton(
                      formatActualCell(row.cells.ytd.actualUsd),
                      ytdActualClickable,
                      onActualCellClick ? () => onActualCellClick(row, 'ytd') : undefined,
                      row.tone === 'revenue' ? 'revenue' : undefined,
                    )}
                  </td>
                  <td className="num">
                    <span className={`budget-variance-chip budget-variance-${ytdTone}`}>{formatVarianceCell(row.cells.ytd.varianceUsd)}</span>
                  </td>
                  <td className="budget-table-divider" />
                  <td className="num">
                    {renderCellButton(
                      formatBudgetCell(row.cells.annual.budgetUsd),
                      false,
                      onBudgetCellClick ? () => onBudgetCellClick(row, 'annual') : undefined,
                    )}
                  </td>
                  <td className="num" style={{ color: row.tone === 'revenue' ? '#04a776' : 'var(--muted)' }}>
                    {renderCellButton(
                      formatActualCell(row.cells.annual.actualUsd),
                      false,
                      onActualCellClick ? () => onActualCellClick(row, 'annual') : undefined,
                      row.tone === 'revenue' ? 'revenue' : undefined,
                    )}
                  </td>
                  <td className="num">
                    <span className={`budget-variance-chip budget-variance-${annualTone}`}>{formatVarianceCell(row.cells.annual.varianceUsd)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
