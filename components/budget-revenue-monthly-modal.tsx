'use client'

import { useEffect } from 'react'

import { fmtUSD } from '@/lib/format'
import type { BudgetRevenueMonthlyBreakdown } from '@/lib/budget/types'

type BudgetRevenueMonthlyModalProps = {
  open: boolean
  loading: boolean
  error: string | null
  breakdown: BudgetRevenueMonthlyBreakdown | null
  onClose: () => void
}

const MONTH_LABELS: Record<string, string> = {
  '01': 'January',
  '02': 'February',
  '03': 'March',
  '04': 'April',
  '05': 'May',
  '06': 'June',
  '07': 'July',
  '08': 'August',
  '09': 'September',
  '10': 'October',
  '11': 'November',
  '12': 'December',
}

export function BudgetRevenueMonthlyModal({
  open,
  loading,
  error,
  breakdown,
  onClose,
}: BudgetRevenueMonthlyModalProps) {
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  const todayIso = new Date().toISOString().slice(0, 10)

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: '520px', maxWidth: '96vw' }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="budget-actual-header">
            <div className="budget-actual-header-main">
              {breakdown ? (
                <span className="budget-actual-badge">{breakdown.accountNumber}</span>
              ) : null}
              <span className="modal-title">
                Core Product Revenue{breakdown ? ` · ${breakdown.year}` : ''}
              </span>
            </div>
            {!loading && !error && breakdown ? (
              <span className="budget-actual-total" style={{ color: '#04a776' }}>
                {fmtUSD(breakdown.ytdTotalUsd, 0)}
              </span>
            ) : null}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close revenue breakdown">×</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ padding: 20 }}>
              <div className="status-bar budget-plan-status">
                <span className="status-dot loading" />
                <span className="status-text">Loading monthly revenue…</span>
              </div>
            </div>
          ) : null}

          {error ? (
            <div style={{ padding: 20 }}>
              <div className="status-bar budget-plan-status">
                <span className="status-dot warn" />
                <span className="status-text">{error}</span>
              </div>
            </div>
          ) : null}

          {!loading && !error && breakdown ? (
            <>
              <div className="budget-actual-subheader">
                {breakdown.entity} · YTD total {fmtUSD(breakdown.ytdTotalUsd, 0)} · Annual {fmtUSD(breakdown.annualTotalUsd, 0)}
              </div>
              <div className="table-wrap">
                <table className="budget-actual-drill-table">
                  <thead>
                    <tr>
                      <th className="sticky-first">Month</th>
                      <th className="num">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.months.map((entry) => {
                      const isFuture = entry.periodStart > todayIso
                      const hasData = entry.actualUsd > 0
                      const muted = !hasData || isFuture
                      const tone = muted ? 'var(--muted)' : '#04a776'

                      return (
                        <tr key={entry.month} style={{ opacity: muted ? 0.45 : 1 }}>
                          <td className="sticky-first label" style={{ color: muted ? 'var(--muted)' : undefined }}>
                            {MONTH_LABELS[entry.month] ?? entry.month}
                          </td>
                          <td className="num" style={{ fontWeight: 600, color: tone }}>
                            {hasData ? fmtUSD(entry.actualUsd, 0) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
