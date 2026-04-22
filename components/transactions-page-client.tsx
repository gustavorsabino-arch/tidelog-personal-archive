'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { ENTITIES, TOKEN_COLORS } from '@/lib/constants'
import { fmtUSD, fmtNum, fmtAddr } from '@/lib/format'
import { DataTable } from '@/components/data-table'
import type { Transaction, TransactionSummary, TransactionsResponse } from '@/lib/types'

type TransactionsPageClientProps = {
  initialEntity: string
  initialTransactions: Transaction[]
  initialTotal: number
  initialSummary: TransactionSummary
  pageSize: number
}

function monthToRange(monthKey: string): { from: string; to: string } | null {
  if (!monthKey) return null
  const [yearStr, monthStr] = monthKey.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0))
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0))
  return {
    from: String(Math.floor(start.getTime() / 1000)),
    to: String(Math.floor(end.getTime() / 1000) - 1),
  }
}

function buildMonthOptions(): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
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
  const didHydrate = useRef(false)

  // Server-side filters
  const [tokenFilter, setTokenFilter] = useState('')
  const [dirFilter, setDirFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')
  // Client-side search over the current page only
  const [search, setSearch] = useState('')

  // Pagination — offset into the server-side sorted result set
  const [offset, setOffset] = useState(0)

  const monthOptions = useMemo(buildMonthOptions, [])

  const fetchTransactions = useCallback(async () => {
    if (!entity) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ entity, limit: String(pageSize), offset: String(offset) })
      if (tokenFilter) params.set('asset', tokenFilter)
      if (dirFilter) params.set('direction', dirFilter)
      if (walletFilter) params.set('wallet', walletFilter)
      const range = monthToRange(monthFilter)
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
  }, [entity, pageSize, offset, tokenFilter, dirFilter, walletFilter, monthFilter])

  // Reset offset when any server-side filter changes (including entity).
  useEffect(() => {
    if (!didHydrate.current) return
    setOffset(0)
  }, [entity, tokenFilter, dirFilter, walletFilter, monthFilter])

  useEffect(() => {
    if (!didHydrate.current) {
      didHydrate.current = true
      return
    }
    if (entity) fetchTransactions()
  }, [fetchTransactions, entity])

  // Wallet dropdown — build from current page; adequate since wallet is a
  // server-side filter and the page always contains the currently-filtered set.
  const wallets = useMemo(() => {
    const map = new Map<string, string>()
    transactions.forEach((t) => {
      if (t.wallet && !map.has(t.wallet)) map.set(t.wallet, t.wallet)
    })
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [transactions])

  // Client-side search narrows the current page only. All other filters go
  // through the server and operate across the whole dataset.
  const filtered = useMemo(() => {
    if (!search) return transactions
    const s = search.toLowerCase()
    return transactions.filter((t) => {
      if ((t.txHash || '').toLowerCase().includes(s)) return true
      if ((t.wallet || '').toLowerCase().includes(s)) return true
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

  const columns = [
    {
      key: 'date', label: 'Date', width: '140px',
      render: (t: Transaction) => {
        const d = new Date(t.date)
        return <span style={{ fontSize: '0.72rem' }}>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} <span style={{ color: 'var(--muted)', fontSize: '0.65rem' }}>{d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span></span>
      },
    },
    {
      key: 'wallet', label: 'Wallet', width: '180px',
      render: (t: Transaction) => (
        <span style={{ fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap', maxWidth: 170 }} title={t.walletAddr}>
          {t.wallet || fmtAddr(t.walletAddr)}
        </span>
      ),
    },
    {
      key: 'dir', label: 'Dir', width: '50px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ fontWeight: 600, fontSize: '0.72rem' }}>
          {t.dir}
        </span>
      ),
    },
    {
      key: 'asset', label: 'Token', width: '70px',
      render: (t: Transaction) => {
        const c = TOKEN_COLORS[t.asset] || '#888'
        return <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${c}18`, color: c }}>{t.asset}</span>
      },
    },
    {
      key: 'qty', label: 'Qty', numeric: true, width: '120px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'}>
          {t.dir === 'In' ? '+' : '-'}{fmtNum(t.qty, t.asset === 'SOL' ? 4 : 2)}
        </span>
      ),
    },
    {
      key: 'price', label: 'Price', numeric: true, width: '90px',
      render: (t: Transaction) => (
        <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
          {t.price ? `$${t.price.toFixed(t.asset === 'ORCA' ? 4 : 2)}` : '—'}
        </span>
      ),
    },
    {
      key: 'usd', label: 'USD', numeric: true, width: '110px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ fontWeight: 500 }}>
          {t.usd ? fmtUSD(t.usd) : '—'}
        </span>
      ),
    },
    {
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
    },
  ]

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

      {loading ? (
        <div className="status-bar">
          <span className="status-dot loading" />
          <span className="status-text">Loading transactions…</span>
        </div>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <>
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
                <select className="fsel" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
                  <option value="">All months</option>
                  {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>
                  {wallets.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <input className="fsearch" placeholder="Hash / wallet (current page)…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>

            <DataTable
              data={filtered as unknown as Record<string, unknown>[]}
              columns={columns as any}
              defaultSort={{ col: 'date', dir: 'desc' }}
              maxHeight="650px"
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
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  style={{ cursor: hasPrev && !loading ? 'pointer' : 'not-allowed', opacity: hasPrev && !loading ? 1 : 0.5 }}
                >
                  ‹ Prev
                </button>
                <button
                  className="fsel"
                  disabled={!hasNext || loading}
                  onClick={() => setOffset(offset + pageSize)}
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
