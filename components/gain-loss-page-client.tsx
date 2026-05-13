'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { ENTITIES, TOKEN_COLORS } from '@/lib/constants'
import { fmtUSD, fmtNum, monthToRange, yearToRange, MONTH_SHORT_NAMES } from '@/lib/format'
import { useEntityWallets } from '@/lib/hooks/use-entity-wallets'
import { useGainLossMonths } from '@/lib/hooks/use-gain-loss-months'
import { Skeleton } from '@/components/skeleton'
import { DataTable } from '@/components/data-table'
import { CopyButton } from '@/components/copy-button'
import type { GainLossEntry, GainLossResponse, GainLossSummary } from '@/lib/types'

type GainLossPageClientProps = {
  initialEntity: string
  initialGainLoss: GainLossEntry[]
  initialSummary: GainLossSummary
}

export function GainLossPageClient({
  initialEntity,
  initialGainLoss,
  initialSummary,
}: GainLossPageClientProps) {
  const [entity, setEntity] = useState(initialEntity)
  const [gainLoss, setGainLoss] = useState<GainLossEntry[]>(initialGainLoss)
  const [summary, setSummary] = useState<GainLossSummary>(initialSummary)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Server-side filters (require a refetch)
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  // Client-side filters (narrow the already-fetched dataset)
  const [tokenFilter, setTokenFilter] = useState('')
  const [termFilter, setTermFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')

  const { options: walletOptions } = useEntityWallets(entity)
  const { years: yearOptions, byYear: monthsByYear, loading: monthsLoading } = useGainLossMonths(entity)

  async function fetchData() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ entity })
      const range = monthFilter ? monthToRange(monthFilter) : yearToRange(yearFilter)
      if (range) {
        params.set('from', range.from)
        params.set('to', range.to)
      }
      const res = await apiFetch<GainLossResponse>(`/api/treasury/gain-loss?${params}`)
      setGainLoss(res.gainLoss)
      setSummary(res.summary)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // One-way flag: flips true the first time state moves away from SSR initial
  // values, and stays true. Skips the redundant initial fetch (state already
  // came from SSR) without suppressing later refetches when the user happens
  // to reset filters back to their initial values.
  const hasInteracted = useRef(false)

  useEffect(() => {
    const atInitialState =
      entity === initialEntity && !yearFilter && !monthFilter
    if (!atInitialState) hasInteracted.current = true
    if (!hasInteracted.current && atInitialState) return
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, initialEntity, yearFilter, monthFilter])

  // Stale-selection resets — drop a selection that's no longer in the available
  // options after an entity switch or data change. Avoids a stuck filter that
  // would silently produce zero rows.
  useEffect(() => {
    if (walletFilter && walletOptions.length > 0 && !walletOptions.some(o => o.value === walletFilter)) {
      setWalletFilter('')
    }
  }, [walletFilter, walletOptions])

  useEffect(() => {
    if (!yearFilter) return
    if (yearOptions.length > 0 && !yearOptions.includes(yearFilter)) {
      setYearFilter('')
      setMonthFilter('')
    }
  }, [yearFilter, yearOptions])

  useEffect(() => {
    if (!monthFilter) return
    const [y, m] = monthFilter.split('-')
    const monthsForYear = monthsByYear[y]
    if (monthsForYear && !monthsForYear.includes(m)) {
      setMonthFilter('')
    }
  }, [monthFilter, monthsByYear])

  // Token options reflect the assets present in the current (server-filtered)
  // dataset, so e.g. narrowing by year hides tokens with no disposals that year.
  const tokenOptions = useMemo(
    () => Array.from(new Set(gainLoss.map(g => g.asset))).sort(),
    [gainLoss],
  )

  useEffect(() => {
    if (tokenFilter && tokenOptions.length > 0 && !tokenOptions.includes(tokenFilter)) {
      setTokenFilter('')
    }
  }, [tokenFilter, tokenOptions])

  const filtered = useMemo(() => {
    return gainLoss.filter(g => {
      if (tokenFilter && g.asset !== tokenFilter) return false
      if (termFilter && g.term !== termFilter) return false
      if (walletFilter && g.walletAddr !== walletFilter) return false
      return true
    })
  }, [gainLoss, tokenFilter, termFilter, walletFilter])

  const filteredSummary = useMemo(() => ({
    totalGain: filtered.reduce((s, g) => s + g.gain, 0),
    shortTermGain: filtered.filter(g => g.term === 'ST').reduce((s, g) => s + g.gain, 0),
    longTermGain: filtered.filter(g => g.term === 'LT').reduce((s, g) => s + g.gain, 0),
    dispositions: filtered.length,
  }), [filtered])

  const columns = [
    {
      key: 'soldDate', label: 'Sold Date', width: '120px',
      render: (g: GainLossEntry) => (
        <span style={{ fontSize: '0.72rem' }}>
          {new Date(g.soldDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
        </span>
      ),
    },
    {
      key: 'wallet', label: 'Wallet', width: '180px',
      render: (g: GainLossEntry) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 170, minWidth: 0 }}>
          <span
            title={g.wallet || g.walletAddr}
            style={{ fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {g.wallet}
          </span>
          <CopyButton address={g.walletAddr} />
        </span>
      ),
    },
    {
      key: 'asset', label: 'Token', width: '70px',
      render: (g: GainLossEntry) => {
        const c = TOKEN_COLORS[g.asset] || '#888'
        return <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${c}18`, color: c }}>{g.asset}</span>
      },
    },
    {
      key: 'qty', label: 'Qty', numeric: true, width: '100px',
      render: (g: GainLossEntry) => <span>{fmtNum(g.qty, 2)}</span>,
    },
    {
      key: 'buyPrice', label: 'Avg In', numeric: true, width: '90px',
      render: (g: GainLossEntry) => <span style={{ color: 'var(--muted)' }}>${g.buyPrice.toFixed(4)}</span>,
    },
    {
      key: 'sellPrice', label: 'Sold At', numeric: true, width: '90px',
      render: (g: GainLossEntry) => <span>${g.sellPrice.toFixed(4)}</span>,
    },
    {
      key: 'gain', label: 'Gain/Loss', numeric: true, width: '120px',
      render: (g: GainLossEntry) => (
        <span className={g.gain >= 0 ? 'gain-pos' : 'gain-neg'} style={{ fontWeight: 600 }}>
          {g.gain >= 0 ? '+' : ''}{fmtUSD(g.gain)}
        </span>
      ),
    },
    {
      key: 'term', label: 'Term', width: '50px',
      render: (g: GainLossEntry) => (
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', padding: '1px 6px', borderRadius: 3,
          background: g.term === 'LT' ? 'var(--green-bg)' : 'var(--orange-bg)',
          color: g.term === 'LT' ? 'var(--green)' : 'var(--orange)' }}>
          {g.term}
        </span>
      ),
    },
    {
      key: 'txHash', label: 'Tx', width: '100px', sortable: false,
      render: (g: GainLossEntry) => g.txHash
        ? <a href={`https://solscan.io/tx/${g.txHash}`} target="_blank" rel="noreferrer"
            style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--accent)', textDecoration: 'none' }}>
            {g.txHash.slice(0, 8)}…{g.txHash.slice(-4)}
          </a>
        : <span style={{ color: 'var(--muted)' }}>—</span>,
    },
  ]

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Gain / Loss</div>
        <div className="page-sub">Realized gains and losses — FIFO cost basis</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map(e => (
            <button key={e} className={`entity-tab${entity === e ? ' active' : ''}`} onClick={() => setEntity(e)}>{e}</button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <>
          {loading ? (
            <div className="cards-grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="card">
                  <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
                  <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
                  <Skeleton width={120} height={10} />
                </div>
              ))}
            </div>
          ) : (
          <div className="cards-grid">
            <div className="card">
              <div className="card-label">Total Realized</div>
              <div className={`card-value ${filteredSummary.totalGain >= 0 ? 'green' : 'red'}`}>
                {filteredSummary.totalGain >= 0 ? '+' : ''}{fmtUSD(filteredSummary.totalGain)}
              </div>
              <div className="card-sub">
                {tokenFilter || termFilter || walletFilter || yearFilter || monthFilter ? 'Filtered view' : 'Full entity data'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Short Term</div>
              <div className={`card-value ${filteredSummary.shortTermGain >= 0 ? 'green' : 'red'}`}>
                {filteredSummary.shortTermGain >= 0 ? '+' : ''}{fmtUSD(filteredSummary.shortTermGain)}
              </div>
              <div className="card-sub">
                {tokenFilter || termFilter || walletFilter || yearFilter || monthFilter ? 'Filtered view' : 'Full entity data'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Long Term</div>
              <div className={`card-value ${filteredSummary.longTermGain >= 0 ? 'green' : 'red'}`}>
                {filteredSummary.longTermGain >= 0 ? '+' : ''}{fmtUSD(filteredSummary.longTermGain)}
              </div>
              <div className="card-sub">
                {tokenFilter || termFilter || walletFilter || yearFilter || monthFilter ? 'Filtered view' : 'Full entity data'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Dispositions</div>
              <div className="card-value">{filteredSummary.dispositions}</div>
              <div className="card-sub">
                {tokenFilter || termFilter || walletFilter || yearFilter || monthFilter ? `${summary.dispositions.toLocaleString()} total` : 'Full entity data'}
              </div>
            </div>
          </div>
          )}

          <div className="section">
            <div className="section-header">
              <span className="section-title">{filtered.length} realized events</span>
              <div className="section-filters">
                <select
                  className="fsel"
                  value={yearFilter}
                  onChange={e => { setYearFilter(e.target.value); setMonthFilter('') }}
                  disabled={monthsLoading || yearOptions.length === 0}
                  title={
                    monthsLoading
                      ? 'Loading available periods…'
                      : yearOptions.length === 0
                        ? 'This entity has no realized gain/loss yet'
                        : ''
                  }
                >
                  <option value="">
                    {monthsLoading
                      ? 'Loading…'
                      : yearOptions.length === 0
                        ? 'No realized events'
                        : 'All years'}
                  </option>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select
                  className="fsel"
                  value={monthFilter}
                  onChange={e => setMonthFilter(e.target.value)}
                  disabled={!yearFilter}
                  title={yearFilter ? '' : 'Select a year first'}
                >
                  <option value="">{yearFilter ? 'All months' : 'Select year first'}</option>
                  {yearFilter && (monthsByYear[yearFilter] ?? []).map(m => (
                    <option key={m} value={`${yearFilter}-${m}`}>{MONTH_SHORT_NAMES[Number(m) - 1]}</option>
                  ))}
                </select>
                <select className="fsel" value={tokenFilter} onChange={e => setTokenFilter(e.target.value)}>
                  <option value="">All tokens</option>
                  {tokenOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="fsel" value={termFilter} onChange={e => setTermFilter(e.target.value)}>
                  <option value="">All terms</option>
                  <option value="ST">Short Term</option>
                  <option value="LT">Long Term</option>
                </select>
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>
                  {walletOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <DataTable data={filtered as unknown as Record<string, unknown>[]} columns={columns as any} defaultSort={{ col: 'soldDate', dir: 'desc' }} maxHeight="600px" />
          </div>
        </>
      )}
    </div>
  )
}
