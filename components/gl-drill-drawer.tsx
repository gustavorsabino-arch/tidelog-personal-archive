'use client'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITY_COLORS } from '@/lib/constants'
import { fmtUSD } from '@/lib/format'
import type { GlDrillResult, GlDrillScope } from '@/lib/qb/gl-data'

type Props = {
  open: boolean
  onClose: () => void
  entity: GlDrillScope
  accountNumber: string
  accountLabel: string
  periodStart: string
  periodEnd: string
}

export function GlDrillDrawer({
  open, onClose, entity, accountNumber, accountLabel, periodStart, periodEnd,
}: Props) {
  const [classFilter, setClassFilter] = useState<string>('')
  const [entityFilter, setEntityFilter] = useState<string>('')

  // Reset filters whenever the drawer is reopened on a new account/period.
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

  if (!open) return null

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`General ledger for ${accountLabel}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(560px, 100vw)',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          zIndex: 101,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{
          padding: '16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {accountLabel}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2 }}>
              {accountNumber} · {periodStart} → {periodEnd} · {entity}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', color: 'var(--text)',
            cursor: 'pointer', fontSize: '1.2rem', padding: 4,
          }}>×</button>
        </header>

        {partialEntities.length > 0 && (
          <div style={{
            padding: '8px 16px', background: 'rgba(255,200,0,0.1)',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text)', fontSize: '0.75rem',
          }}>
            No cached GL for: {partialEntities.join(', ')}.
          </div>
        )}

        <div style={{
          padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center',
          borderBottom: '1px solid var(--border)',
        }}>
          {allClasses.length > 1 && (
            <select
              className="fsel"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Filter by class"
            >
              <option value="">All classes</option>
              {allClasses.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          {entityFilter && (
            <button
              onClick={() => setEntityFilter('')}
              style={{
                fontSize: '0.7rem', color: 'var(--muted)',
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
              }}
            >clear: {entityFilter} ×</button>
          )}
          <div style={{ flex: 1, textAlign: 'right', fontSize: '0.75rem', color: 'var(--muted)' }}>
            {filtered.length} txns · <span style={{ fontFamily: 'var(--mono)' }}>{fmtUSD(filteredTotal)}</span>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {isLoading || (!isCurrent && !error) ? (
            <div style={{ padding: 16, color: 'var(--muted)', fontSize: '0.85rem' }}>Loading…</div>
          ) : errorCode === 'gl.not_cached' ? (
            <div className="empty" style={{ padding: 32 }}>
              <div className="empty-icon">⏳</div>
              <div>No cached transactions for this account in this period.</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 8 }}>
                Wait for the next fetch-qb-reports cron run, or run <code>bun run cron fetch-qb-reports</code> locally.
              </div>
            </div>
          ) : error ? (
            <div className="empty" style={{ padding: 32 }}>
              <div className="empty-icon">⚠️</div>
              <div>{error instanceof Error ? error.message : String(error)}</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty" style={{ padding: 32 }}>
              <div className="empty-icon">📋</div>
              <div>No transactions in this period.</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={th}>Date</th>
                  <th style={th}>Type</th>
                  <th style={th}>Name</th>
                  <th style={th}>Memo</th>
                  {showClassColumn && <th style={th}>Class</th>}
                  {showEntityColumn && <th style={th}>Entity</th>}
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={`${r.txnId ?? 'noid'}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={td}>{r.date}</td>
                    <td style={td}>{r.transactionType ?? ''}</td>
                    <td style={td}>{r.name ?? ''}</td>
                    <td style={td}>{r.memo ?? ''}</td>
                    {showClassColumn && <td style={td}>{r.className ?? ''}</td>}
                    {showEntityColumn && (
                      <td style={td}>
                        <button
                          onClick={() => setEntityFilter(entityFilter === r.entity ? '' : r.entity)}
                          style={{
                            background: 'transparent', border: 'none',
                            color: ENTITY_COLORS[r.entity] ?? 'var(--text)',
                            cursor: 'pointer', fontWeight: entityFilter === r.entity ? 700 : 500,
                            padding: 0, font: 'inherit',
                          }}
                          title={`Filter to ${r.entity}`}
                        >{r.entity}</button>
                      </td>
                    )}
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {fmtUSD(r.amountUsd ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  )
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: '0.65rem',
  color: 'var(--muted)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
}

const td: React.CSSProperties = {
  padding: '6px 10px',
}
