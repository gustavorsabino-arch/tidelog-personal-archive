'use client'

import { useEffect } from 'react'

import { getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { fmtUSD } from '@/lib/format'
import type { BudgetActualDrillState } from '@/lib/budget/types'

type BudgetActualDrillModalProps = {
  open: boolean
  title: string
  loading: boolean
  error: string | null
  drill: BudgetActualDrillState | null
  isAdmin: boolean
  onClose: () => void
  // Optional export handler. When provided (currently the search-aggregated
  // drill) an "Export" button appears next to the close button and calls it.
  onExport?: () => void
  exportLabel?: string
}

function formatSignedUsd(value: number): string {
  const formatted = fmtUSD(Math.abs(value))
  return `${value >= 0 ? '+' : '-'}${formatted}`
}

export function BudgetActualDrillModal({
  open,
  title,
  loading,
  error,
  drill,
  isAdmin,
  onClose,
  onExport,
  exportLabel = 'Export',
}: BudgetActualDrillModalProps) {
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: '1120px', maxWidth: '98vw' }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="budget-actual-header">
            <div className="budget-actual-header-main">
              {drill ? (
                <span className="budget-actual-badge">
                  {drill.accounts.map((account) => account.accountNumber).join(', ') || '—'}
                </span>
              ) : null}
              <span className="modal-title">{title}</span>
            </div>
            {!loading && !error && drill ? (
              <span
                className="budget-actual-total"
                style={{ color: drill.totalUsd >= 0 ? 'var(--green)' : 'var(--red)' }}
              >
                {formatSignedUsd(drill.totalUsd)}
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {onExport && !loading && !error && drill && drill.transactions.length > 0 ? (
              <button
                className="btn-secondary"
                onClick={onExport}
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                title="Download these transactions as .xlsx"
              >
                {exportLabel}
              </button>
            ) : null}
            <button className="modal-close" onClick={onClose} aria-label="Close actual drill modal">×</button>
          </div>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ padding: 20 }}>
              <div className="status-bar budget-plan-status">
                <span className="status-dot loading" />
                <span className="status-text">Loading transaction detail…</span>
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

          {!loading && !error && drill ? (
            <>
              <div className="budget-actual-subheader">
                {drill.transactions.length} transaction{drill.transactions.length !== 1 ? 's' : ''}
                {drill.department ? ` · class: ${getBudgetDepartmentLabel(drill.department)}` : ''}
              </div>

              {isAdmin && Math.abs(drill.unreconciledTotalUsd) > 0.005 ? (
                <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--orange-bg)', color: 'var(--orange)', fontFamily: 'var(--mono)', fontSize: '0.68rem' }}>
                  QuickBooks returned an unreconciled drill delta of {formatSignedUsd(drill.unreconciledTotalUsd)} for this selection. The table below shows only the signed line items we could attribute directly.
                </div>
              ) : null}

              <div className="table-wrap">
                <table className="budget-actual-drill-table">
                  <thead>
                    <tr>
                      <th className="sticky-first">Transaction date</th>
                      <th>Ref</th>
                      <th>Name</th>
                      <th>Memo / Description</th>
                      <th>Account full name</th>
                      <th className="num">Amount</th>
                      <th>Entity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.transactions.length > 0 ? drill.transactions.map((transaction) => {
                      const amountTone = transaction.amountUsd >= 0 ? 'var(--green)' : 'var(--red)'
                      const amountText = formatSignedUsd(transaction.amountUsd)

                      return (
                        <tr key={transaction.id}>
                          <td className="sticky-first" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{transaction.date || '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>{transaction.documentNumber || '—'}</td>
                          <td className="label" title={transaction.name || '—'}>{transaction.name || '—'}</td>
                          <td className="label" title={transaction.memo || '—'}>{transaction.memo || '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: '0.66rem' }} title={transaction.splitName || '—'}>{transaction.splitName || '—'}</td>
                          <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {transaction.txnId && transaction.realmId ? (
                              <a
                                href={`https://app.qbo.intuit.com/app/journal?txnId=${encodeURIComponent(transaction.txnId)}&companyId=${encodeURIComponent(transaction.realmId)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="budget-actual-link"
                                style={{ color: amountTone }}
                              >
                                {amountText}
                              </a>
                            ) : (
                              <span style={{ color: amountTone }}>{amountText}</span>
                            )}
                          </td>
                          <td style={{ color: 'var(--muted)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>{transaction.entity || '—'}</td>
                        </tr>
                      )
                    }) : (
                      <tr>
                        <td colSpan={7}>
                          <div className="empty budget-empty-inline">
                            <div className="empty-icon">∅</div>
                            <div>No transactions found for this period.</div>
                          </div>
                        </td>
                      </tr>
                    )}
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
