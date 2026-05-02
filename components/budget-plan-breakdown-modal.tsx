'use client'

import { useEffect } from 'react'

import { getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { fmtUSD } from '@/lib/format'
import { getBudgetPlanBreakdownSubtitle } from '@/lib/budget/drill'
import type { BudgetPlanBreakdownState } from '@/lib/budget/types'

type BudgetPlanBreakdownModalProps = {
  breakdown: BudgetPlanBreakdownState | null
  onClose: () => void
}

export function BudgetPlanBreakdownModal({ breakdown, onClose }: BudgetPlanBreakdownModalProps) {
  useEffect(() => {
    if (!breakdown) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [breakdown, onClose])

  if (!breakdown) return null

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: '760px', maxWidth: '96vw' }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{breakdown.rowLabel}</div>
            <div className="modal-sub">
              {getBudgetPlanBreakdownSubtitle(breakdown.view, breakdown.column)}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close budget breakdown modal">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="sticky-first">Department</th>
                  <th className="num">Budget</th>
                  <th className="num">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.entries.length > 0 ? breakdown.entries.map((entry) => (
                  <tr key={entry.department}>
                    <td className="sticky-first label">{getBudgetDepartmentLabel(entry.department)}</td>
                    <td className="num">{fmtUSD(entry.amountUsd, 0)}</td>
                    <td className="num">
                      <div className="budget-breakdown-share">
                        <div className="budget-breakdown-share-bar">
                          <div
                            className="budget-breakdown-share-fill"
                            style={{ width: `${Math.min(entry.pctOfTotal * 100, 100)}%` }}
                          />
                        </div>
                        <span className="budget-breakdown-share-pct">{(entry.pctOfTotal * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={3}>
                      <div className="empty budget-empty-inline">
                        <div className="empty-icon">∅</div>
                        <div>No budget allocated.</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <span style={{ color: 'var(--muted)' }}>Total Budget</span>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{fmtUSD(breakdown.totalUsd, 0)}</span>
        </div>
      </div>
    </div>
  )
}
