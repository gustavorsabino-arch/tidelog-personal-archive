'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES, ENTITY_COLORS, TOKEN_COLORS, STABLE_TOKENS } from '@/lib/constants'
import { fmtUSD, fmtNum, pctOf } from '@/lib/format'
import { OverviewTrendModal } from '@/components/overview-trend-modal'
import { Skeleton } from '@/components/skeleton'
import { buildOverviewDrilldown, getSortedActiveTokens } from '@/lib/overview'
import type { TreasuryOverview } from '@/lib/types'

export default function OverviewPage() {
  const [entity, setEntity] = useState<string>('')
  const [drilldownKey, setDrilldownKey] = useState<string | null>(null)
  const [trendModal, setTrendModal] = useState<{
    walletAddr: string
    walletLabel: string
    scopeTitle: string
    tokens: string[]
  } | null>(null)
  const swrKey = `/api/treasury/overview${entity ? `?entity=${entity}` : ''}`
  const { data, isLoading, error: swrError, mutate } = useSWR<TreasuryOverview>(
    swrKey,
    apiFetch<TreasuryOverview>,
  )
  const loading = isLoading
  const error = swrError ? (swrError instanceof Error ? swrError.message : String(swrError)) : null
  const refresh = () => { void mutate() }

  const prices = data?.prices || {}
  const wallets = data?.wallets || []
  const entityTotals = data?.entityTotals || {}
  const tokenTotals = data?.tokenTotals || {}
  const grandTotal = data?.grandTotalUSD || 0

  const activeTokens = getSortedActiveTokens(tokenTotals)
  const stableTokens = activeTokens.filter(token => STABLE_TOKENS.has(token))
  const featuredTokens = activeTokens.filter(token => !STABLE_TOKENS.has(token) && (tokenTotals[token]?.usd || 0) > 0).slice(0, 3)
  const stablesUSD = stableTokens.reduce((sum, token) => sum + (tokenTotals[token]?.usd || 0), 0)
  const stableSummary = stableTokens
    .map(token => `${token} ${fmtNum(tokenTotals[token]?.amount || 0, 0)}`)
    .join(' · ')
  const priceSummary = activeTokens
    .filter(token => typeof prices[token] === 'number' && !STABLE_TOKENS.has(token))
    .slice(0, 3)
    .map(token => `${token} $${Number(prices[token]).toFixed(token === 'ORCA' ? 4 : 2)}`)
    .join(' · ')
  const drilldown = useMemo(
    () => (data && drilldownKey ? buildOverviewDrilldown(data, drilldownKey) : null),
    [data, drilldownKey]
  )

  const pct = (v: number) => grandTotal > 0 ? (v / grandTotal * 100).toFixed(1) : '0.0'
  const toggleDrilldown = (key: string) => setDrilldownKey(current => current === key ? null : key)

  return (
    <div>
      {/* Controls bar */}
      <div className="controls-bar">
        <div className="entity-tabs">
          {['', ...ENTITIES].map(e => (
            <button
              key={e}
              className={`entity-tab${entity === e ? ' active' : ''}`}
              onClick={() => setEntity(e)}
            >
              {e || 'All'}
            </button>
          ))}
        </div>
        <button className="fetch-btn" onClick={refresh} disabled={loading}>
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Status bar */}
      <div className="status-bar">
        <span className={`status-dot ${loading ? 'loading' : data?.snapshotDate ? 'live' : 'idle'}`} />
        <span className="status-text">
          {loading
            ? 'Fetching treasury data…'
            : error
              ? `Error: ${error}`
              : `Portfolio balances · ${wallets.length} wallets${priceSummary ? ` · ${priceSummary}` : ''}`
          }
        </span>
        <span className="status-meta">
          {data?.snapshotDate ? `as of ${data.snapshotDate}` : ''}
        </span>
      </div>

      {/* Summary cards */}
      {loading && !data ? (
        <div className="cards-grid">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="card" style={{ borderTop: '3px solid var(--border)' }}>
              <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
              <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
              <Skeleton width={180} height={10} style={{ marginBottom: 10 }} />
              <Skeleton height={4} radius={2} />
            </div>
          ))}
        </div>
      ) : (
      <div className="cards-grid">
        {/* Total Portfolio */}
        <div className="card" style={{ borderTop: '3px solid var(--accent)' }}>
          <div className="card-label">Total Portfolio</div>
          <div className="card-value blue">{fmtUSD(grandTotal, 0)}</div>
          <div className="card-sub">
            {wallets.length} wallets · {Object.keys(entityTotals).length} entities
          </div>
        </div>

        {/* Stablecoins */}
        <div className="card" style={{ borderTop: '3px solid #2775CA' }}>
          <button
            type="button"
            className="card-clickable"
            onClick={() => toggleDrilldown('stables')}
          >
            <div className="card-label">Stablecoins <span style={{ color: '#2775CA', fontSize: '0.6rem' }}>▾</span></div>
            <div className="card-value">{fmtUSD(stablesUSD, 0)}</div>
            <div className="card-sub">
              {pct(stablesUSD)}%{stableSummary ? ` · ${stableSummary}` : ' · No stable balances'}
            </div>
            <div className="card-bar">
              <div className="card-bar-fill" style={{ width: `${pct(stablesUSD)}%`, background: '#2775CA' }} />
            </div>
          </button>
        </div>

        {featuredTokens.map(token => {
          const usd = tokenTotals[token]?.usd || 0
          const amount = tokenTotals[token]?.amount || 0
          const color = TOKEN_COLORS[token] || TOKEN_COLORS.default
          const price = prices[token]

          return (
            <div key={token} className="card" style={{ borderTop: `3px solid ${color}` }}>
              <button
                type="button"
                className="card-clickable"
                onClick={() => toggleDrilldown(`token:${token}`)}
              >
                <div className="card-label">{token} <span style={{ color, fontSize: '0.6rem' }}>▾</span></div>
                <div className="card-value">{fmtUSD(usd, 0)}</div>
                <div className="card-sub">
                  {pct(usd)}% · {fmtNum(amount, token === 'SOL' ? 2 : 0)} {token} · ${typeof price === 'number' ? price.toFixed(token === 'ORCA' ? 4 : 2) : '—'}
                </div>
                <div className="card-bar">
                  <div className="card-bar-fill" style={{ width: `${pct(usd)}%`, background: color }} />
                </div>
              </button>
            </div>
          )
        })}
      </div>
      )}

      {/* Entity cards */}
      <div style={{
        marginBottom: 8, fontFamily: 'var(--mono)', fontSize: '0.62rem',
        textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)',
      }}>
        By Entity
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 12, marginBottom: 24,
      }}>
        {loading && !data ? (
          ENTITIES.map(ent => (
            <div key={ent} className="card" style={{ borderTop: '3px solid var(--border)' }}>
              <Skeleton width={80} height={14} style={{ marginBottom: 8 }} />
              <Skeleton width={140} height={22} style={{ marginBottom: 12 }} />
              <Skeleton height={4} radius={2} style={{ marginBottom: 12 }} />
              <Skeleton width="100%" height={12} style={{ marginBottom: 6 }} />
              <Skeleton width="100%" height={12} style={{ marginBottom: 6 }} />
              <Skeleton width="100%" height={12} />
            </div>
          ))
        ) : ENTITIES.map(ent => {
          const et = entityTotals[ent]
          if (!et) return null
          const c = ENTITY_COLORS[ent] || '#888'
          const entPct = pct(et.totalUSD)
          const activeToks = Object.entries(et.tokens)
            .filter(([, amount]) => amount > 0)
            .sort((a, b) => {
              const usdDiff = (et.tokenUsd[b[0]] || 0) - (et.tokenUsd[a[0]] || 0)
              if (usdDiff !== 0) return usdDiff
              return b[1] - a[1]
            })
            .map(([token]) => token)

          return (
            <div key={ent} className="card" style={{ borderTop: `3px solid ${c}` }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', fontWeight: 700, color: c }}>{ent}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'var(--muted)', marginLeft: 'auto' }}>
                  {et.walletCount} wallets
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'var(--muted)' }}>
                  {entPct}% of portfolio
                </span>
              </div>

              {/* Total */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '1.25rem', fontWeight: 600 }}>
                  {fmtUSD(et.totalUSD, 0)}
                </span>
                <button
                  type="button"
                  onClick={() => toggleDrilldown(`entity:${ent}:all`)}
                  style={{
                    marginLeft: 'auto',
                    fontFamily: 'var(--mono)',
                    fontSize: '0.62rem',
                    padding: '3px 9px',
                    borderRadius: 4,
                    border: `1px solid ${c}55`,
                    background: `${c}12`,
                    color: c,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  All ›
                </button>
              </div>

              {/* Progress bar */}
              <div className="card-bar" style={{ marginBottom: 12 }}>
                <div className="card-bar-fill" style={{ width: `${entPct}%`, background: c }} />
              </div>

              {/* Token rows */}
              {activeToks.map(t => {
                const tc = TOKEN_COLORS[t] || '#888'
                const amt = et.tokens[t] || 0
                const usd = et.tokenUsd[t] || 0
                return (
                  <div key={t} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px',
                    borderRadius: 5, borderBottom: '1px solid var(--border)',
                  }}>
                    <button
                      type="button"
                      onClick={() => toggleDrilldown(`entity:${ent}:token:${t}`)}
                      className="overview-token-row"
                    >
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700,
                        padding: '1px 6px', borderRadius: 3, background: `${tc}18`, color: tc,
                        minWidth: 40, textAlign: 'center',
                      }}>
                        {t}
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', flex: 1, textAlign: 'left' }}>
                        {fmtNum(amt, t === 'SOL' ? 4 : 2)}
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--accent)', minWidth: 72, textAlign: 'right' }}>
                        {fmtUSD(usd, 0)}
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'var(--muted)', minWidth: 36, textAlign: 'right' }}>
                        {pctOf(usd, grandTotal)}%
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>›</span>
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {drilldown && (
        <div
          className="card"
          style={{
            borderTop: `3px solid ${drilldown.accentColor}`,
            padding: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px 14px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.92rem', fontWeight: 700, color: drilldown.accentColor }}>
              {drilldown.title}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--muted)' }}>
              {drilldown.walletCount} wallets
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.92rem', fontWeight: 600, color: 'var(--text)', marginLeft: 'auto' }}>
              {fmtUSD(drilldown.subtotalUSD, 0)}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--muted)' }}>
              {drilldown.portfolioPct.toFixed(1)}% of portfolio
            </span>
            <button
              type="button"
              onClick={() => setDrilldownKey(null)}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: '0.7rem',
                padding: '3px 10px',
                borderRadius: 5,
                border: '1px solid var(--border)',
                background: 'var(--surface2)',
                color: 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
          <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--border)', borderRadius: 0, boxShadow: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Wallet</th>
                  {drilldown.showEntityColumn && <th>Entity</th>}
                  <th className="num">Total USD</th>
                  {drilldown.rowTokens.map(token => (
                    <th key={token} className="num" style={{ color: TOKEN_COLORS[token] || 'var(--muted)' }}>
                      {token}
                    </th>
                  ))}
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {drilldown.rows.length ? drilldown.rows.map(row => {
                  const rowPct = drilldown.subtotalUSD > 0 ? row.totalUSD / drilldown.subtotalUSD * 100 : 0
                  const entityColor = ENTITY_COLORS[row.entity] || '#888'

                  return (
                    <tr
                      key={row.walletAddr}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setTrendModal({
                        walletAddr: row.walletAddr,
                        walletLabel: row.walletLabel,
                        scopeTitle: drilldown.title,
                        tokens: drilldown.rowTokens,
                      })}
                    >
                      <td>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.73rem', fontWeight: 600 }}>{row.walletLabel || '—'}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.61rem', color: 'var(--muted)' }}>
                          <Link
                            href={`https://solscan.io/account/${row.walletAddr}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={event => event.stopPropagation()}
                            style={{ color: 'inherit', textDecoration: 'none' }}
                          >
                            {row.walletAddr.slice(0, 8)}…{row.walletAddr.slice(-6)}
                          </Link>
                        </div>
                      </td>
                      {drilldown.showEntityColumn && (
                        <td>
                          <span style={{
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontSize: '0.65rem',
                            fontFamily: 'var(--mono)',
                            fontWeight: 600,
                            background: `${entityColor}18`,
                            color: entityColor,
                          }}>
                            {row.entity}
                          </span>
                        </td>
                      )}
                      <td className="num" style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent)' }}>
                        {fmtUSD(row.totalUSD, 0)}
                      </td>
                      {drilldown.rowTokens.map(token => {
                        const amount = row.tokenAmounts[token] || 0
                        const usd = row.tokenUsd[token] || 0
                        const tokenColor = TOKEN_COLORS[token] || TOKEN_COLORS.default

                        if (!amount) {
                          return <td key={token} className="num" style={{ color: 'var(--muted)' }}>—</td>
                        }

                        return (
                          <td key={token} className="num">
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.73rem', color: tokenColor, fontWeight: 600 }}>
                              {fmtNum(amount, token === 'SOL' || token === 'ETH' ? 4 : 0)}
                            </div>
                            {!STABLE_TOKENS.has(token) && (
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.61rem', color: 'var(--muted)' }}>
                                {fmtUSD(usd, 0)}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="num">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                          <div style={{ width: 36, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.min(rowPct, 100)}%`,
                                background: drilldown.accentColor,
                                borderRadius: 2,
                              }}
                            />
                          </div>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                            {rowPct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td
                      colSpan={drilldown.rowTokens.length + (drilldown.showEntityColumn ? 4 : 3)}
                      style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}
                    >
                      No wallets with this token selection
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {trendModal && (
        <OverviewTrendModal
          walletAddr={trendModal.walletAddr}
          walletLabel={trendModal.walletLabel}
          scopeTitle={trendModal.scopeTitle}
          tokens={trendModal.tokens}
          onClose={() => setTrendModal(null)}
        />
      )}
    </div>
  )
}
