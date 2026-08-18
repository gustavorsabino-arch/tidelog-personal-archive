'use client'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITY_COLORS } from '@/lib/constants'
import { fmtUSD } from '@/lib/format'
import type { GlDrillResult, GlDrillScope } from '@/lib/qb/gl-data'

/**
 * Centered modal listing every cached QB GL transaction for one account +
 * period. Shared by /pnl and /accounting (amount / GL-badge click). Styled
 * with the SAME css classes as the budget actual-drill modal
 * (components/budget-actual-drill-modal.tsx) so the two drills look
 * identical — Kate's request after the original side-drawer proved too
 * cramped for the data.
 */

type Props = {
  open: boolean
  onClose: () => void
  entity: GlDrillScope
  accountNumber: string
  accountLabel: string
  periodStart: string
  periodEnd: string
}

function formatSignedUsd(value: number): string {
  const formatted = fmtUSD(Math.abs(value))
  return `${value >= 0 ? '+' : '-'}${formatted}`
}

export function GlDrillModal({
  open, onClose, entity, accountNumber, accountLabel, periodStart, periodEnd,
}: Props) {
  const [classFilter, setClassFilter] = useState<string>('')
  const [entityFilter, setEntityFilter] = useState<string>('')

  // Reset filters whenever the modal is reopened on a new account/period.
  useEffect(() => {
    if (open) {
      setClassFilter('')
      setEntityFilter('')
    }
  }, [open, entity, accountNumber, periodStart, periodEnd])

  // Close on Escape — but let native <select>/dropdown swallow Escape first.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (e.target instanceof HTMLSelectElement) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const swrKey = open
    ? `/api/qb/gl?entity=${entity}&accountNumber=${encodeURIComponent(accountNumber)}&periodStart=${periodStart}&periodEnd=${periodEnd}`
    : null

  const { data, error, isLoading } = useSWR<GlDrillResult>(swrKey, apiFetch<GlDrillResult>)

  // Stale-key guard: only trust data when echoed params match current request.
  const isCurrent = !!data
    && data.entity === entity
    && data.accountNumber === accountNumber
    && data.periodStart === periodStart
    && data.periodEnd === periodEnd

  const rows = isCurrent ? data.rows : []
  const allClasses = isCurrent ? data.classes : []
  const partialEntities = isCurrent ? data.partialEntities : []
  const showEntityColumn = entity === 'All'
  const showClassColumn = rows.some((r) => r.className)

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (classFilter && r.className !== classFilter) return false
      if (entityFilter && r.entity !== entityFilter) return false
      return true
    })
  }, [rows, classFilter, entityFilter])

  const filteredTotal = useMemo(
    () => filtered.reduce((acc, r) => acc + (r.amountUsd ?? 0), 0),
    [filtered],
  )

  const errorCode = (() => {
    if (!error) return null
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('gl.not_cached') || msg.includes('No cached GL data')) return 'gl.not_cached'
    return 'unknown'
  })()

  const loading = isLoading || (!isCurrent && !error)

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: '1120px', maxWidth: '98vw' }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="budget-actual-header">
            <div className="budget-actual-header-main">
              <span className="budget-actual-badge">{accountNumber}</span>
              <span className="modal-title">{accountLabel}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                {periodStart} → {periodEnd} · {entity}
              </span>
            </div>
            {!loading && !error ? (
              <span
                className="budget-actual-total"
                style={{ color: filteredTotal >= 0 ? 'var(--green)' : 'var(--red)' }}
              >
                {formatSignedUsd(filteredTotal)}
              </span>
            ) : null}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close GL drill modal">×</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ padding: 20 }}>
              <div className="status-bar budget-plan-status">
                <span className="status-dot loading" />
                <span className="status-text">Loading transaction detail…</span>
              </div>
            </div>
          ) : errorCode === 'gl.not_cached' ? (
            <div className="empty" style={{ padding: 40 }}>
              <div className="empty-icon">⏳</div>
              <div>No cached transactions for this account in this period.</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 8 }}>
                Wait for the next fetch-qb-reports cron run, or trigger a QuickBooks force refresh.
              </div>
            </div>
          ) : error ? (
            <div style={{ padding: 20 }}>
              <div className="status-bar budget-plan-status">
                <span className="status-dot warn" />
                <span className="status-text">{error instanceof Error ? error.message : String(error)}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="budget-actual-subheader" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span>
                  {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
                  {classFilter ? ` · class: ${classFilter}` : ''}
                  {entityFilter ? ` · entity: ${entityFilter}` : ''}
                </span>
                <span style={{ flex: 1 }} />
                {allClasses.length > 1 ? (
                  <select
                    className="fsel"
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    aria-label="Filter by class"
                    style={{ fontSize: '0.7rem' }}
                  >
                    <option value="">All classes</option>
                    {allClasses.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : null}
                {entityFilter ? (
                  <button
                    onClick={() => setEntityFilter('')}
                    style={{
                      fontSize: '0.7rem', color: 'var(--muted)',
                      background: 'transparent', border: '1px solid var(--border)',
                      borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
                    }}
                  >clear: {entityFilter} ×</button>
                ) : null}
              </div>

              {partialEntities.length > 0 ? (
                <div style={{
                  padding: '10px 20px', borderBottom: '1px solid var(--border)',
                  background: 'rgba(255,200,0,0.1)', color: 'var(--text)',
                  fontFamily: 'var(--mono)', fontSize: '0.68rem',
                }}>
                  No cached GL for: {partialEntities.join(', ')}.
                </div>
              ) : null}

              <div className="table-wrap">
                <table className="budget-actual-drill-table">
                  <thead>
                    <tr>
                      <th className="sticky-first">Transaction date</th>
                      <th>Type</th>
                      <th>Ref</th>
                      <th>Name</th>
                      <th>Memo / Description</th>
                      <th>Split</th>
                      {showClassColumn ? <th>Class</th> : null}
                      <th className="num">Amount</th>
                      {showEntityColumn ? <th>Entity</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length > 0 ? filtered.map((r, i) => {
                      const amountTone = (r.amountUsd ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'
                      return (
                        <tr key={`${r.txnId ?? 'noid'}-${i}`}>
                          <td className="sticky-first" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.date || '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>{r.transactionType || '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>{r.documentNumber || '—'}</td>
                          <td className="label" title={r.name || '—'}>{r.name || '—'}</td>
                          <td className="label" title={r.memo || '—'}>{r.memo || '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: '0.66rem' }} title={r.splitName || '—'}>{r.splitName || '—'}</td>
                          {showClassColumn ? (
                            <td style={{ color: 'var(--muted)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>{r.className || '—'}</td>
                          ) : null}
                          <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap', color: amountTone }}>
                            {formatSignedUsd(r.amountUsd ?? 0)}
                          </td>
                          {showEntityColumn ? (
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => setEntityFilter(entityFilter === r.entity ? '' : r.entity)}
                                style={{
                                  background: 'transparent', border: 'none',
                                  color: ENTITY_COLORS[r.entity] ?? 'var(--text)',
                                  cursor: 'pointer', fontWeight: entityFilter === r.entity ? 700 : 500,
                                  padding: 0, font: 'inherit', fontSize: '0.66rem',
                                }}
                                title={`Filter to ${r.entity}`}
                              >{r.entity}</button>
                            </td>
                          ) : null}
                        </tr>
                      )
                    }) : (
                      <tr>
                        <td colSpan={7 + (showClassColumn ? 1 : 0) + (showEntityColumn ? 1 : 0)}>
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
          )}
        </div>
      </div>
    </div>
  )
}
