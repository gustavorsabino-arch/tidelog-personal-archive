'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, apiPost } from '@/lib/api'
import { useSharedAccess } from '@/lib/access-context'

type ForceRefreshStatus = 'running' | 'succeeded' | 'failed' | 'canceled'

type ForceRefreshRun = {
  id: string
  startedAt: string
  finishedAt: string | null
  fromPeriod: string
  status: ForceRefreshStatus
  requestedByEmail: string
  error: string | null
  durationMs: number | null
}

type ForceRefreshPanelProps = {
  /** When this prop changes, the panel refetches runs from the server. */
  refreshKey?: unknown
}

const HISTORY_START = '2026-01'

function buildMonthOptions(now: Date = new Date()): string[] {
  const out: string[] = []
  const [startYear, startMonth] = HISTORY_START.split('-').map(Number)
  const nowY = now.getUTCFullYear()
  const nowM = now.getUTCMonth() + 1
  for (let y = startYear; y <= nowY; y++) {
    const lastMonth = y === nowY ? nowM : 12
    const firstMonth = y === startYear ? startMonth : 1
    for (let m = firstMonth; m <= lastMonth; m++) {
      out.push(`${y}-${String(m).padStart(2, '0')}`)
    }
  }
  return out
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const ms = Date.now() - then
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m${rs > 0 ? ` ${rs}s` : ''}`
}

function statusIcon(status: ForceRefreshStatus): string {
  if (status === 'running') return '🔵'
  if (status === 'succeeded') return '✅'
  if (status === 'canceled') return '🚫'
  return '❌'
}

export function ForceRefreshPanel({ refreshKey }: ForceRefreshPanelProps) {
  const { access } = useSharedAccess()
  const myEmail = access?.email?.toLowerCase() ?? null
  const monthOptions = useMemo(() => buildMonthOptions(), [])
  const [fromPeriod, setFromPeriod] = useState<string>(HISTORY_START)
  const [runs, setRuns] = useState<ForceRefreshRun[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadRuns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<{ runs: ForceRefreshRun[] }>('/api/admin/qb/force-refresh')
      setRuns(data.runs)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setFromPeriod(HISTORY_START)
    setNotice(null)
    setError(null)
    loadRuns()
  }, [loadRuns, refreshKey])

  const isRunning = runs?.some((r) => r.status === 'running') ?? false

  async function start() {
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      await apiPost('/api/admin/qb/force-refresh', { from: fromPeriod })
      setNotice(`Refresh started from ${fromPeriod}. Takes 5–10 min. You can close this dialog.`)
      await loadRuns()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelRun(runId: string) {
    setCancelingId(runId)
    setError(null)
    setNotice(null)
    try {
      await apiPost('/api/admin/qb/force-refresh/cancel', { runId })
      setNotice('Refresh canceled. The background job will exit at the next break point.')
      await loadRuns()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCancelingId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="section-title">Force refresh cache</div>
        <div className="budget-section-note">
          Re-pulls reports and transactions from the selected month onward. The run
          lasts 5–10 minutes; existing data stays usable while it runs.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 auto' }}>
          <span className="budget-scope-label">From month</span>
          <select
            className="fsel"
            value={fromPeriod}
            onChange={(event) => setFromPeriod(event.target.value)}
            disabled={submitting || isRunning}
            style={{ minWidth: 140 }}
          >
            {monthOptions.map((month) => (
              <option key={month} value={month}>{month}</option>
            ))}
          </select>
        </label>
        <button
          className="btn-primary"
          onClick={start}
          disabled={submitting || isRunning}
          title={isRunning ? 'A refresh is already in progress' : undefined}
        >
          {submitting ? 'Starting…' : 'Start refresh'}
        </button>
        <button className="btn-secondary" onClick={loadRuns} disabled={loading || submitting}>
          {loading ? 'Refreshing…' : 'Refresh list'}
        </button>
      </div>

      {notice && (
        <div className="status-bar" style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)' }}>
          <span className="status-dot" />
          <span className="status-text">{notice}</span>
        </div>
      )}

      {error && (
        <div className="status-bar">
          <span className="status-dot err" />
          <span className="status-text">{error}</span>
        </div>
      )}

      <div>
        <div className="section-title" style={{ marginBottom: 8 }}>Recent runs</div>
        {runs === null ? (
          <div className="empty">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="empty">No runs yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {runs.map((run) => {
              const isMine = myEmail !== null && run.requestedByEmail.toLowerCase() === myEmail
              const canCancel = run.status === 'running' && isMine
              return (
                <article
                  key={run.id}
                  className="card"
                  style={{
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    background: run.status === 'running'
                      ? 'color-mix(in srgb, var(--accent) 6%, transparent)'
                      : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span>{statusIcon(run.status)}</span>
                    <strong style={{ textTransform: 'capitalize' }}>{run.status}</strong>
                    <span style={{ opacity: 0.75 }}>· from {run.fromPeriod}</span>
                    <span style={{ opacity: 0.75 }}>· {formatRelative(run.startedAt)}</span>
                    {run.durationMs !== null && (
                      <span style={{ opacity: 0.75 }}>· {formatDuration(run.durationMs)}</span>
                    )}
                    {canCancel && (
                      <button
                        className="btn-secondary"
                        onClick={() => cancelRun(run.id)}
                        disabled={cancelingId === run.id}
                        style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: '0.75rem' }}
                      >
                        {cancelingId === run.id ? 'Canceling…' : 'Cancel'}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '0.82rem', opacity: 0.8 }}>
                    {run.requestedByEmail}
                  </div>
                  {run.error && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--red)', wordBreak: 'break-word' }}>
                      {run.error}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
