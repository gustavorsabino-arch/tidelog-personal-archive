'use client'
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES, TOKEN_COLORS } from '@/lib/constants'
import { fmtUSD, fmtNum } from '@/lib/format'
import { Skeleton } from '@/components/skeleton'
import { CopyButton } from '@/components/copy-button'
import { computeFIFO } from '@/lib/fifo'
import type { Transaction, Prices } from '@/lib/types'

type TxResponse = { transactions: Transaction[] }
type PriceResponse = { prices: Prices }

async function fetchUnrealizedData(entity: string) {
  const [txRes, priceRes] = await Promise.all([
    apiFetch<TxResponse>(`/api/treasury/transactions?entity=${entity}&limit=all`),
    apiFetch<PriceResponse>('/api/prices'),
  ])
  return computeFIFO(txRes.transactions, priceRes.prices as Record<string, number>)
}

export default function UnrealizedPage() {
  const [entity, setEntity] = useState('Opco')

  // Filters
  const [tokenFilter, setTokenFilter] = useState('')
  const [signFilter, setSignFilter] = useState('')

  const { data: fifoResult, isLoading, error: swrError, mutate } = useSWR(
    `unrealized:${entity}`,
    () => fetchUnrealizedData(entity),
  )

  const unrealized = fifoResult?.unrealized ?? []
  const loading = isLoading
  const error = swrError ? (swrError instanceof Error ? swrError.message : String(swrError)) : null

  const filtered = useMemo(() => {
    return unrealized.filter(u => {
      if (tokenFilter && u.asset !== tokenFilter) return false
      if (signFilter === '+' && u.unrealGain < 0) return false
      if (signFilter === '-' && u.unrealGain >= 0) return false
      return true
    })
  }, [unrealized, tokenFilter, signFilter])

  const totalUnreal = filtered.reduce((s, u) => s + u.unrealGain, 0)
  const totalCost = filtered.reduce((s, u) => s + u.costBasis, 0)
  const totalValue = filtered.reduce((s, u) => s + u.qty * u.currentPrice, 0)

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Unrealized</div>
        <div className="page-sub">Unrealized gains by wallet and token — FIFO cost basis vs current price</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map(e => (
            <button key={e} className={`entity-tab${entity === e ? ' active' : ''}`} onClick={() => setEntity(e)}>{e}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <>
          <div className="cards-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card">
                <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
                <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
                <Skeleton width={180} height={10} />
              </div>
            ))}
          </div>
          <div className="section">
            <div className="table-wrap" style={{ maxHeight: '600px', overflow: 'auto' }}>
              <table>
                <tbody>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 10px' }}><Skeleton width={160} height={12} /></td>
                      <td style={{ padding: '6px 10px' }}><Skeleton width={50} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={70} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={70} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <>
          <div className="cards-grid">
            <div className="card">
              <div className="card-label">Unrealized Gain/Loss</div>
              <div className={`card-value ${totalUnreal >= 0 ? 'green' : 'red'}`}>
                {totalUnreal >= 0 ? '+' : ''}{fmtUSD(totalUnreal)}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Cost Basis</div>
              <div className="card-value">{fmtUSD(totalCost)}</div>
            </div>
            <div className="card">
              <div className="card-label">Current Value</div>
              <div className="card-value blue">{fmtUSD(totalValue)}</div>
            </div>
            <div className="card">
              <div className="card-label">Positions</div>
              <div className="card-value">{filtered.length}</div>
            </div>
          </div>

          <div className="section">
            <div className="section-header">
              <span className="section-title">{filtered.length} open positions</span>
              <div className="section-filters">
                <select className="fsel" value={tokenFilter} onChange={e => setTokenFilter(e.target.value)}>
                  <option value="">All tokens</option>
                  <option value="SOL">SOL</option>
                  <option value="ORCA">ORCA</option>
                </select>
                <select className="fsel" value={signFilter} onChange={e => setSignFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="+">Gains only</option>
                  <option value="-">Losses only</option>
                </select>
              </div>
            </div>

            <div className="table-wrap" style={{ maxHeight: '600px', overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Token</th>
                    <th className="num">Qty</th>
                    <th className="num">Cost Basis</th>
                    <th className="num">Current Price</th>
                    <th className="num">Current Value</th>
                    <th className="num">Unrealized</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--sans)' }}>
                      No unrealized positions. Requires transaction history with prices.
                    </td></tr>
                  ) : filtered.map((u, i) => {
                    const c = TOKEN_COLORS[u.asset] || '#888'
                    const value = u.qty * u.currentPrice
                    return (
                      <tr key={i}>
                        <td className="label" style={{ maxWidth: 200 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0 }}>
                            <span
                              title={u.wallet || u.walletAddr}
                              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                            >
                              {u.wallet}
                            </span>
                            <CopyButton address={u.walletAddr} />
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${c}18`, color: c }}>{u.asset}</span>
                        </td>
                        <td className="num">{fmtNum(u.qty, u.asset === 'SOL' ? 4 : 2)}</td>
                        <td className="num">{fmtUSD(u.costBasis)}</td>
                        <td className="num" style={{ color: 'var(--muted)' }}>${u.currentPrice.toFixed(u.asset === 'ORCA' ? 4 : 2)}</td>
                        <td className="num">{fmtUSD(value)}</td>
                        <td className={`num ${u.unrealGain >= 0 ? 'gain-pos' : 'gain-neg'}`} style={{ fontWeight: 600 }}>
                          {u.unrealGain >= 0 ? '+' : ''}{fmtUSD(u.unrealGain)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
