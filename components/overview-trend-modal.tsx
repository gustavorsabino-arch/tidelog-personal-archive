'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { fmtAddr, fmtDate, fmtNum, fmtUSD } from '@/lib/format'
import { TOKEN_COLORS } from '@/lib/constants'
import type { TreasuryOverviewTrendResponse } from '@/lib/types'

type OverviewTrendModalProps = {
  walletAddr: string
  walletLabel: string
  scopeTitle: string
  tokens: string[]
  onClose: () => void
}

type SeriesMode = 'total' | string

function buildLinePath(values: number[], width: number, height: number): string {
  if (!values.length) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : index / (values.length - 1) * width
    const y = height - ((value - min) / range) * height
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

function buildAreaPath(linePath: string, values: number[], width: number, height: number): string {
  if (!values.length || !linePath) return ''
  const startX = values.length === 1 ? width / 2 : 0
  const endX = values.length === 1 ? width / 2 : width
  return `${linePath} L ${endX.toFixed(2)} ${height} L ${startX.toFixed(2)} ${height} Z`
}

export function OverviewTrendModal({
  walletAddr,
  walletLabel,
  scopeTitle,
  tokens,
  onClose,
}: OverviewTrendModalProps) {
  const [data, setData] = useState<TreasuryOverviewTrendResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<SeriesMode>('total')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await apiFetch<TreasuryOverviewTrendResponse>(
          `/api/treasury/overview/trend?wallet=${encodeURIComponent(walletAddr)}&tokens=${encodeURIComponent(tokens.join(','))}`
        )
        if (!cancelled) {
          setData(result)
          setMode('total')
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'Unknown error'
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [walletAddr, tokens])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const series = useMemo(() => {
    const points = data?.points || []
    const values = points.map(point => mode === 'total' ? point.totalUsd : (point.tokenUsd[mode] || 0))
    const current = values.at(-1) || 0
    const start = values[0] || 0
    const change = current - start
    const high = values.length ? Math.max(...values) : 0
    const low = values.length ? Math.min(...values) : 0
    return { values, current, start, change, high, low }
  }, [data, mode])

  const path = useMemo(() => buildLinePath(series.values, 640, 220), [series.values])
  const areaPath = useMemo(() => buildAreaPath(path, series.values, 640, 220), [path, series.values])
  const accentColor = mode === 'total' ? 'var(--accent)' : (TOKEN_COLORS[mode] || TOKEN_COLORS.default)
  const points = data?.points || []
  const firstDate = data?.firstDate || null
  const lastDate = data?.lastDate || null
  const pointCount = points.length
  const showSeriesButtons = tokens.length > 1
  const modeLabel = mode === 'total' ? 'Total Wallet Value' : `${mode} Value`
  const subtitle = firstDate && lastDate ? `${fmtDate(firstDate)} → ${fmtDate(lastDate)}` : 'Historical balance range'
  const latestPoint = points.at(-1) || null

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal trend-modal" style={{ width: '860px', maxWidth: '96vw' }} onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Wallet Balance Trend</div>
            <div className="modal-sub">
              {walletLabel} · {fmtAddr(walletAddr, 6)}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close trend modal">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="trend-meta">
            <span className="trend-chip">Scope: {scopeTitle}</span>
            <span className="trend-chip">Series: {modeLabel}</span>
            <span className="trend-chip">{pointCount} snapshots</span>
          </div>

          <div className="trend-toggle-group">
            <button
              type="button"
              onClick={() => setMode('total')}
              className={`trend-toggle ${mode === 'total' ? 'active' : ''}`}
              style={{
                borderColor: 'var(--accent)',
                color: mode === 'total' ? '#fff' : 'var(--accent)',
                background: mode === 'total' ? 'var(--accent)' : 'transparent',
              }}
            >
              Total
            </button>
            {showSeriesButtons && tokens.map(token => {
              const color = TOKEN_COLORS[token] || TOKEN_COLORS.default
              const active = mode === token
              return (
                <button
                  key={token}
                  type="button"
                  onClick={() => setMode(token)}
                  className={`trend-toggle ${active ? 'active' : ''}`}
                  style={{
                    borderColor: color,
                    color: active ? '#fff' : color,
                    background: active ? color : 'transparent',
                  }}
                >
                  {token}
                </button>
              )
            })}
          </div>

          {loading ? (
            <div className="status-bar"><span className="status-dot loading" /><span className="status-text">Loading wallet trend…</span></div>
          ) : error ? (
            <div className="status-bar"><span className="status-dot" /><span className="status-text">Error: {error}</span></div>
          ) : !pointCount ? (
            <div className="status-bar"><span className="status-dot" /><span className="status-text">No balance history available yet for this wallet.</span></div>
          ) : (
            <>
              <div className="cards-grid" style={{ marginBottom: 18 }}>
                <div className="card">
                  <div className="card-label">Latest Value</div>
                  <div className="card-value" style={{ color: accentColor }}>{fmtUSD(series.current, 0)}</div>
                  <div className="card-sub">{lastDate ? `Snapshot on ${fmtDate(lastDate)}` : 'Latest snapshot'}</div>
                </div>
                <div className="card">
                  <div className="card-label">Range Change</div>
                  <div className={`card-value ${series.change >= 0 ? 'green' : 'red'}`}>{fmtUSD(series.change, 0)}</div>
                  <div className="card-sub">{subtitle}</div>
                </div>
                <div className="card">
                  <div className="card-label">Peak Value</div>
                  <div className="card-value">{fmtUSD(series.high, 0)}</div>
                  <div className="card-sub">{pointCount} daily snapshots</div>
                </div>
                <div className="card">
                  <div className="card-label">Lowest Value</div>
                  <div className="card-value">{fmtUSD(series.low, 0)}</div>
                  <div className="card-sub">{modeLabel}</div>
                </div>
              </div>

              <div className="trend-chart-shell">
                <div className="trend-chart-head">
                  <div>
                    <div className="trend-chart-title">{modeLabel}</div>
                    <div className="trend-chart-sub">{subtitle}</div>
                  </div>
                  {latestPoint && (
                    <div className="trend-chart-current">
                      <span className="trend-chart-current-label">Latest</span>
                      <span className="trend-chart-current-value" style={{ color: accentColor }}>
                        {fmtUSD(series.current, 0)}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ position: 'relative', height: 260 }}>
                  <svg viewBox="0 0 640 220" preserveAspectRatio="none" style={{ width: '100%', height: '220px', overflow: 'visible' }}>
                    {[0, 55, 110, 165, 220].map(y => (
                      <line key={y} x1="0" y1={y} x2="640" y2={y} stroke="var(--border)" strokeWidth="1" />
                    ))}
                    {areaPath && <path d={areaPath} fill={accentColor} opacity="0.12" />}
                    <path d={path} fill="none" stroke={accentColor} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                    {series.values.map((value, index) => {
                      const min = Math.min(...series.values)
                      const max = Math.max(...series.values)
                      const range = max - min || 1
                      const x = series.values.length === 1 ? 320 : index / (series.values.length - 1) * 640
                      const y = 220 - ((value - min) / range) * 220
                      const isLast = index === series.values.length - 1
                      return <circle key={`${points[index]?.date}-${index}`} cx={x} cy={y} r={isLast ? '4.5' : '3'} fill={accentColor} />
                    })}
                  </svg>
                </div>
                <div className="trend-chart-foot">
                  <span>{firstDate ? fmtDate(firstDate) : '—'}</span>
                  <span>{lastDate ? fmtDate(lastDate) : '—'}</span>
                </div>
              </div>

              <div className="trend-note">
                Historical wallet balance from daily snapshots. This chart shows value over time, not transaction in/out flow.
              </div>

              <div className="table-wrap" style={{ marginTop: 18, maxHeight: 240 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Snapshot Date</th>
                      <th className="num">Wallet USD</th>
                      {tokens.map(token => (
                        <th key={token} className="num" style={{ color: TOKEN_COLORS[token] || 'var(--muted)' }}>{token}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...points].reverse().map(point => (
                      <tr key={point.date}>
                        <td>{fmtDate(point.date)}</td>
                        <td className="num" style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmtUSD(point.totalUsd, 0)}</td>
                        {tokens.map(token => (
                          <td key={token} className="num" style={{ fontFamily: 'var(--mono)' }}>
                            {fmtNum(point.tokenAmounts[token] || 0, token === 'SOL' || token === 'ETH' ? 4 : 2)}
                          </td>
                        ))}
                      </tr>
                    ))}
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
