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
import type { GainLossEntry, GainLossPagination, GainLossResponse, GainLossSummary } from '@/lib/types'

type GainLossPageClientProps = {
  initialEntity: string
  initialGainLoss: GainLossEntry[]
  initialSummary: GainLossSummary
  initialPagination: GainLossPagination
}

const PAGE_SIZE_OPTIONS = [100, 250, 500]

export function GainLossPageClient({
  initialEntity,
  initialGainLoss,
  initialSummary,
  initialPagination,
}: GainLossPageClientProps) {
  const [entity, setEntity] = useState(initialEntity)
  const [gainLoss, setGainLoss] = useState<GainLossEntry[]>(initialGainLoss)
  const [summary, setSummary] = useState<GainLossSummary>(initialSummary)
  const [pagination, setPagination] = useState<GainLossPagination>(initialPagination)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // All filters are now server-side — refetch triggers on any change.
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [tokenFilter, setTokenFilter] = useState('')
  const [termFilter, setTermFilter] = useState<'' | 'ST' | 'LT'>('')
  const [walletFilter, setWalletFilter] = useState('')

  // Pagination state.
  const [page, setPage] = useState(initialPagination.page)
  const [pageSize, setPageSize] = useState(initialPagination.pageSize)

  const { options: walletOptions } = useEntityWallets(entity)
  const { years: yearOptions, byYear: monthsByYear, loading: monthsLoading } = useGainLossMonths(entity)

  async function fetchData(targetPage: number = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ entity })
      const range = monthFilter ? monthToRange(monthFilter) : yearToRange(yearFilter)
      if (range) {
        params.set('from', range.from)
        params.set('to', range.to)
      }
      if (tokenFilter) params.set('token', tokenFilter)
      if (termFilter) params.set('term', termFilter)
      if (walletFilter) params.set('walletAddr', walletFilter)
      params.set('page', String(targetPage))
      params.set('pageSize', String(pageSize))

      const res = await apiFetch<GainLossResponse>(`/api/treasury/gain-loss?${params}`)
      setGainLoss(res.gainLoss)
      setSummary(res.summary)
      setPagination(res.pagination)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Whether the client state is identical to what SSR delivered. Used to skip
  // the first useEffect-driven refetch, since the table is already populated.
  const hasInteracted = useRef(false)

  // Any filter or page-size change resets to page 1 and refetches.
  useEffect(() => {
    const atInitialState =
      entity === initialEntity &&
      !yearFilter && !monthFilter && !tokenFilter && !termFilter && !walletFilter &&
      pageSize === initialPagination.pageSize
    if (!atInitialState) hasInteracted.current = true
    if (!hasInteracted.current && atInitialState) return
    setPage(1)
    void fetchData(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, yearFilter, monthFilter, tokenFilter, termFilter, walletFilter, pageSize])

  // Page navigation refetches without resetting filters.
  function goToPage(next: number) {
    const target = Math.max(1, next)
    setPage(target)
    void fetchData(target)
  }

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

  // Token dropdown is now driven by the server's summary.tokens list, which
  // reflects the current filter set (sans token filter itself).
  const tokenOptions = useMemo(() => summary.tokens, [summary.tokens])

  useEffect(() => {
    if (tokenFilter && tokenOptions.length > 0 && !tokenOptions.includes(tokenFilter)) {
      setTokenFilter('')
    }
  }, [tokenFilter, tokenOptions])

  const totalPages = Math.max(1, Math.ceil(pagination.totalRows / pageSize))
  const hasFilter = !!(tokenFilter || termFilter || walletFilter || yearFilter || monthFilter)

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
              <div className={`card-value ${summary.totalGain >= 0 ? 'green' : 'red'}`}>
                {summary.totalGain >= 0 ? '+' : ''}{fmtUSD(summary.totalGain)}
              </div>
              <div className="card-sub">
                {hasFilter ? 'Filtered view' : 'Full entity data'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Short Term</div>
              <div className={`card-value ${summary.shortTermGain >= 0 ? 'green' : 'red'}`}>
                {summary.shortTermGain >= 0 ? '+' : ''}{fmtUSD(summary.shortTermGain)}
              </div>
              <div className="card-sub">
                {hasFilter ? 'Filtered view' : 'Full entity data'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Long Term</div>
              <div className={`card-value ${summary.longTermGain >= 0 ? 'green' : 'red'}`}>
                {summary.longTermGain >= 0 ? '+' : ''}{fmtUSD(summary.longTermGain)}
              </div>
              <div className="card-sub">
                {hasFilter ? 'Filtered view' : 'Full entity data'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Dispositions</div>
              <div className="card-value">{summary.dispositions.toLocaleString()}</div>
              <div className="card-sub">{hasFilter ? 'Filtered view' : 'Full entity data'}</div>
            </div>
          </div>
          )}

          <div className="section">
            <div className="section-header">
              <span className="section-title">
                {pagination.totalRows.toLocaleString()} realized event{pagination.totalRows === 1 ? '' : 's'}
                {pagination.totalRows > 0 && (
                  <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
                    · page {pagination.page} of {totalPages}
                  </span>
                )}
              </span>
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
                <select className="fsel" value={termFilter} onChange={e => setTermFilter(e.target.value as '' | 'ST' | 'LT')}>
                  <option value="">All terms</option>
                  <option value="ST">Short Term</option>
                  <option value="LT">Long Term</option>
                </select>
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>
                  {walletOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select className="fsel" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                  {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s} / page</option>)}
                </select>
              </div>
            </div>
            <DataTable data={gainLoss as unknown as Record<string, unknown>[]} columns={columns as any} defaultSort={{ col: 'soldDate', dir: 'desc' }} maxHeight="600px" />
            {pagination.totalRows > pageSize && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '8px 0' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  Showing {gainLoss.length} of {pagination.totalRows.toLocaleString()} disposal rows
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" disabled={loading || pagination.page <= 1} onClick={() => goToPage(pagination.page - 1)}>
                    ← Prev
                  </button>
                  <span style={{ alignSelf: 'center', fontSize: '0.75rem' }}>
                    Page {pagination.page} of {totalPages}
                  </span>
                  <button className="btn-secondary" disabled={loading || !pagination.hasMore} onClick={() => goToPage(pagination.page + 1)}>
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
