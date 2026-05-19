'use client'

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { ENTITIES, TOKEN_COLORS } from '@/lib/constants'
import { fmtUSD, fmtNum, fmtAddr, monthToRange, yearToRange, MONTH_SHORT_NAMES } from '@/lib/format'
import { useEntityWallets } from '@/lib/hooks/use-entity-wallets'
import { useTransactionMonths } from '@/lib/hooks/use-transaction-months'
import { Skeleton } from '@/components/skeleton'
import { DataTable } from '@/components/data-table'
import { CopyButton } from '@/components/copy-button'
import type { Transaction, TransactionSummary, TransactionsResponse } from '@/lib/types'

type TransactionsPageClientProps = {
  initialEntity: string
  initialTransactions: Transaction[]
  initialTotal: number
  initialSummary: TransactionSummary
  pageSize: number
}

function renderGainCell(
  gain: number | null | undefined,
  t: Transaction,
  monthStartMs: number | null,
  bucket: 'ST' | 'LT',
): React.ReactNode {
  if (gain == null) return <span style={{ color: 'var(--muted)' }}>—</span>
  // ⚠ when a consumed lot pre-dates the active filter window — the realized term may
  // not reflect the cost basis the user expects for "this month's" activity.
  const acqBeforeWindow =
    monthStartMs != null && (t.lots ?? []).some(l => Date.parse(l.acqDate) < monthStartMs)
  const sign = gain > 0 ? '+' : ''
  const cls = gain > 0 ? 'gain-pos' : gain < 0 ? 'gain-neg' : ''
  return (
    <span className={cls} style={{ fontWeight: 500 }}>
      {acqBeforeWindow && (
        <span
          title={`A consumed lot was acquired before the selected period; ${bucket} term may not reflect realized-in-period basis.`}
          style={{ color: 'var(--warn, #d97706)', marginRight: 4 }}
        >⚠</span>
      )}
      {gain === 0 ? '—' : `${sign}${fmtUSD(gain)}`}
    </span>
  )
}

export function TransactionsPageClient({
  initialEntity,
  initialTransactions,
  initialTotal,
  initialSummary,
  pageSize,
}: TransactionsPageClientProps) {
  const [entity, setEntity] = useState<string>(initialEntity)
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions)
  const [total, setTotal] = useState(initialTotal)
  const [summary, setSummary] = useState<TransactionSummary>(initialSummary)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Server-side filters
  const [tokenFilter, setTokenFilter] = useState('')
  const [dirFilter, setDirFilter] = useState('')
  // Year-then-month cascade: month is only meaningful when a year is selected.
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')
  // Client-side search over the current page only
  const [search, setSearch] = useState('')

  // Pagination — offset into the server-side sorted result set
  const [offset, setOffset] = useState(0)

  const { options: walletOptions } = useEntityWallets(entity)
  const { years: yearOptions, byYear: monthsByYear } = useTransactionMonths(entity)

  // Offset is passed in explicitly — never read from closure — so pagination
  // and filter changes can each fire exactly one fetch with the right offset,
  // with no race between an "offset reset" effect and a "fetch on offset
  // change" effect.
  const fetchTransactions = useCallback(async (off: number) => {
    if (!entity) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ entity, limit: String(pageSize), offset: String(off) })
      if (tokenFilter) params.set('asset', tokenFilter)
      if (dirFilter) params.set('direction', dirFilter)
      if (walletFilter) params.set('wallet', walletFilter)
      const range = monthFilter ? monthToRange(monthFilter) : yearToRange(yearFilter)
      if (range) {
        params.set('from', range.from)
        params.set('to', range.to)
      }
      const res = await apiFetch<TransactionsResponse>(`/api/treasury/transactions?${params}`)
      setTransactions(res.transactions)
      setTotal(res.total)
      setSummary(res.summary)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [entity, pageSize, tokenFilter, dirFilter, walletFilter, yearFilter, monthFilter])

  // One-way flag: flips true the first time state moves away from SSR initial
  // values, and stays true. Skips the redundant initial fetch (state already
  // came from SSR) without suppressing later refetches when the user happens
  // to reset filters back to their initial values.
  const hasInteracted = useRef(false)

  // Filter/entity change → always page 1 and fetch.
  useEffect(() => {
    const atInitialState =
      entity === initialEntity &&
      !tokenFilter && !dirFilter && !yearFilter && !monthFilter && !walletFilter
    if (!atInitialState) hasInteracted.current = true
    if (!hasInteracted.current && atInitialState) return
    setOffset(0)
    if (entity) fetchTransactions(0)
  }, [entity, initialEntity, tokenFilter, dirFilter, yearFilter, monthFilter, walletFilter, fetchTransactions])

  // Pagination is an explicit user action, not derived state. Calling fetch
  // directly avoids the effect-driven double-fetch race entirely.
  const goToOffset = (off: number) => {
    setOffset(off)
    fetchTransactions(off)
  }

  // Drop the selected wallet/year/month if they fall out of the available
  // options (entity switch, wallet deletion, etc.). Avoids a stuck filter that
  // would silently produce zero rows.
  useEffect(() => {
    if (walletFilter && walletOptions.length > 0 && !walletOptions.some((o) => o.value === walletFilter)) {
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

  // Client-side search narrows the current page only. All other filters go
  // through the server and operate across the whole dataset.
  const filtered = useMemo(() => {
    if (!search) return transactions
    const s = search.toLowerCase()
    return transactions.filter((t) => {
      if ((t.txHash || '').toLowerCase().includes(s)) return true
      if ((t.wallet || '').toLowerCase().includes(s)) return true
      if ((t.walletAddr || '').toLowerCase().includes(s)) return true
      if ((t.asset || '').toLowerCase().includes(s)) return true
      return false
    })
  }, [transactions, search])

  const totalIn = summary.inflowsUSD
  const totalOut = summary.outflowsUSD
  const totalNet = summary.netUSD

  const page = Math.floor(offset / pageSize) + 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const hasPrev = offset > 0
  const hasNext = offset + pageSize < total
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + transactions.length, total)

  const monthStartMs = useMemo(() => {
    if (!monthFilter) return null
    const [y, m] = monthFilter.split('-').map(Number)
    return Date.UTC(y, m - 1, 1)
  }, [monthFilter])

  const columns = useMemo(() => {
    const dateCol = {
      key: 'date', label: 'Date', width: yearFilter ? '140px' : '160px',
      render: (t: Transaction) => {
        const d = new Date(t.date)
        return (
          <span style={{ fontSize: '0.72rem' }}>
            {d.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              ...(yearFilter ? {} : { year: 'numeric' }),
              timeZone: 'UTC',
            })}
            {' '}
            <span style={{ color: 'var(--muted)', fontSize: '0.65rem' }}>
              {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC
            </span>
          </span>
        )
      },
    }
    const walletCol = {
      key: 'wallet', label: 'Wallet', width: '180px',
      render: (t: Transaction) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 170, minWidth: 0 }}>
          <span
            title={t.wallet || t.walletAddr}
            style={{ fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {t.wallet || fmtAddr(t.walletAddr)}
          </span>
          <CopyButton address={t.walletAddr} />
        </span>
      ),
    }
    const counterpartyCol = {
      key: 'counterparty', label: 'Counterparty', width: '180px', sortable: false,
      render: (t: Transaction) => {
        if (!t.counterparty) return <span style={{ color: 'var(--muted)' }}>—</span>
        const label = t.counterpartyLabel || fmtAddr(t.counterparty)
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 170, minWidth: 0 }}>
            <span
              title={t.counterpartyLabel || t.counterparty}
              style={{ fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
            >
              {label}
            </span>
            <CopyButton address={t.counterparty} />
          </span>
        )
      },
    }
    const dirCol = {
      key: 'dir', label: 'Dir', width: '50px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ fontWeight: 600, fontSize: '0.72rem' }}>
          {t.dir}
        </span>
      ),
    }
    const assetCol = {
      key: 'asset', label: 'Token', width: '70px',
      render: (t: Transaction) => {
        const c = TOKEN_COLORS[t.asset] || '#888'
        return <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${c}18`, color: c }}>{t.asset}</span>
      },
    }
    const qtyCol = {
      key: 'qty', label: 'Qty', numeric: true, width: '120px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'}>
          {t.dir === 'In' ? '+' : '-'}{fmtNum(t.qty, t.asset === 'SOL' ? 4 : 2)}
        </span>
      ),
    }
    const priceCol = {
      key: 'price', label: 'Price', numeric: true, width: '90px',
      render: (t: Transaction) => (
        <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
          {t.price ? `$${t.price.toFixed(t.asset === 'ORCA' ? 4 : 2)}` : '—'}
        </span>
      ),
    }
    const usdCol = {
      key: 'usd', label: 'USD', numeric: true, width: '110px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ fontWeight: 500 }}>
          {t.usd ? fmtUSD(t.usd) : '—'}
        </span>
      ),
    }
    const txHashCol = {
      key: 'txHash', label: 'Tx', width: '100px', sortable: false,
      render: (t: Transaction) => {
        if (!t.txHash) return <span style={{ color: 'var(--muted)' }}>—</span>
        return (
          <a href={`https://solscan.io/tx/${t.txHash}`} target="_blank" rel="noreferrer"
            style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--accent)', textDecoration: 'none' }}
            title={t.txHash}>
            {t.txHash.slice(0, 8)}…{t.txHash.slice(-4)}
          </a>
        )
      },
    }

    const orcaCols = tokenFilter === 'ORCA' ? [
      {
        key: 'stGain', label: 'ST', numeric: true, width: '90px', sortable: false,
        render: (t: Transaction) => renderGainCell(t.stGain, t, monthStartMs, 'ST'),
      },
      {
        key: 'ltGain', label: 'LT', numeric: true, width: '90px', sortable: false,
        render: (t: Transaction) => renderGainCell(t.ltGain, t, monthStartMs, 'LT'),
      },
    ] : []

    return [
      dateCol, walletCol, counterpartyCol, dirCol, assetCol, qtyCol, priceCol, usdCol,
      ...orcaCols,
      txHashCol,
    ]
  }, [tokenFilter, yearFilter, monthStartMs])

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Transactions</div>
        <div className="page-sub">All on-chain movements — debits and credits</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map(e => (
            <button key={e} className={`entity-tab${entity === e ? ' active' : ''}`} onClick={() => setEntity(e)}>
              {e}
            </button>
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
              <div className="card-label">Inflows</div>
              <div className="card-value green">{fmtUSD(totalIn, 0)}</div>
              <div className="card-sub">Full entity data</div>
            </div>
            <div className="card">
              <div className="card-label">Outflows</div>
              <div className="card-value red">{fmtUSD(totalOut, 0)}</div>
              <div className="card-sub">Full entity data</div>
            </div>
            <div className="card">
              <div className="card-label">Net</div>
              <div className={`card-value ${totalNet >= 0 ? 'green' : 'red'}`}>
                {totalNet >= 0 ? '+' : ''}{fmtUSD(totalNet, 0)}
              </div>
              <div className="card-sub">Full entity data</div>
            </div>
            <div className="card">
              <div className="card-label">Transactions</div>
              <div className="card-value">{total.toLocaleString()}</div>
              <div className="card-sub">matching filters</div>
            </div>
          </div>
          )}

          <div className="section">
            <div className="section-header">
              <span className="section-title">
                {total === 0
                  ? 'No transactions'
                  : `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()}`}
              </span>
              <div className="section-filters">
                <select className="fsel" value={tokenFilter} onChange={e => setTokenFilter(e.target.value)}>
                  <option value="">All tokens</option>
                  <option value="SOL">SOL</option>
                  <option value="ORCA">ORCA</option>
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                </select>
                <select className="fsel" value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
                  <option value="">In + Out</option>
                  <option value="In">In</option>
                  <option value="Out">Out</option>
                </select>
                <select
                  className="fsel"
                  value={yearFilter}
                  onChange={e => { setYearFilter(e.target.value); setMonthFilter('') }}
                >
                  <option value="">All years</option>
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
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>
                  {walletOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input className="fsearch" placeholder="Tx hash / wallet / address (current page)…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>

            <DataTable
              data={filtered as unknown as Record<string, unknown>[]}
              columns={columns as any}
              defaultSort={{ col: 'date', dir: 'desc' }}
              maxHeight="650px"
              rowClassName={(row) => (row as unknown as Transaction).internal ? 'tx-row-internal' : undefined}
            />

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderTop: '1px solid var(--border)', gap: 10,
            }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--muted)' }}>
                Page {page} of {pageCount}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="fsel"
                  disabled={!hasPrev || loading}
                  onClick={() => goToOffset(Math.max(0, offset - pageSize))}
                  style={{ cursor: hasPrev && !loading ? 'pointer' : 'not-allowed', opacity: hasPrev && !loading ? 1 : 0.5 }}
                >
                  ‹ Prev
                </button>
                <button
                  className="fsel"
                  disabled={!hasNext || loading}
                  onClick={() => goToOffset(offset + pageSize)}
                  style={{ cursor: hasNext && !loading ? 'pointer' : 'not-allowed', opacity: hasNext && !loading ? 1 : 0.5 }}
                >
                  Next ›
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
