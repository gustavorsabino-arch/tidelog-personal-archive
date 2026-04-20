'use client'
import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '@/lib/api'
import { ENTITIES, TOKEN_COLORS } from '@/lib/constants'
import { fmtUSD, fmtNum, fmtAddr } from '@/lib/format'
import { DataTable } from '@/components/data-table'
import type { Transaction } from '@/lib/types'

export default function OrcaLedgerPage() {
  const [entity, setEntity] = useState('Opco')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [dirFilter, setDirFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')

  async function fetchData() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ entity, asset: 'ORCA', limit: '5000' })
      const res = await apiFetch<{ transactions: Transaction[]; total: number }>(`/api/treasury/transactions?${params}`)
      setTransactions(res.transactions)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [entity])

  const months = useMemo(() => {
    const set = new Set<string>()
    transactions.forEach(t => {
      if (t.date) {
        const d = new Date(t.date)
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      }
    })
    return [...set].sort().reverse()
  }, [transactions])

  const wallets = useMemo(() => {
    const map = new Map<string, string>()
    transactions.forEach(t => { if (t.wallet && !map.has(t.wallet)) map.set(t.wallet, t.wallet) })
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [transactions])

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (dirFilter && t.dir !== dirFilter) return false
      if (walletFilter && t.wallet !== walletFilter) return false
      if (monthFilter) {
        const d = new Date(t.date)
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (mk !== monthFilter) return false
      }
      return true
    })
  }, [transactions, dirFilter, walletFilter, monthFilter])

  const totalIn = filtered.filter(t => t.dir === 'In').reduce((s, t) => s + (t.qty || 0), 0)
  const totalOut = filtered.filter(t => t.dir === 'Out').reduce((s, t) => s + (t.qty || 0), 0)
  const totalUsdIn = filtered.filter(t => t.dir === 'In').reduce((s, t) => s + Math.abs(t.usd || 0), 0)
  const totalUsdOut = filtered.filter(t => t.dir === 'Out').reduce((s, t) => s + Math.abs(t.usd || 0), 0)

  const columns = [
    {
      key: 'date', label: 'Date', width: '140px',
      render: (t: Transaction) => {
        const d = new Date(t.date)
        return <span style={{ fontSize: '0.72rem' }}>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} <span style={{ color: 'var(--muted)', fontSize: '0.65rem' }}>{d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span></span>
      },
    },
    {
      key: 'wallet', label: 'Wallet', width: '200px',
      render: (t: Transaction) => (
        <span style={{ fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap', maxWidth: 190 }} title={t.walletAddr}>
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
      key: 'qty', label: 'Qty', numeric: true, width: '130px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'}>
          {t.dir === 'In' ? '+' : '-'}{fmtNum(t.qty, 2)}
        </span>
      ),
    },
    {
      key: 'price', label: 'Price', numeric: true, width: '100px',
      render: (t: Transaction) => (
        <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
          {t.price ? `$${t.price.toFixed(4)}` : '—'}
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
      key: 'counterparty', label: 'Counterparty', width: '120px', sortable: false,
      render: (t: Transaction) => t.counterparty
        ? <a href={`https://solscan.io/account/${t.counterparty}`} target="_blank" rel="noreferrer"
            style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--muted)', textDecoration: 'none' }}>
            {fmtAddr(t.counterparty, 6)}
          </a>
        : <span style={{ color: 'var(--muted)' }}>—</span>,
    },
    {
      key: 'txHash', label: 'Tx', width: '100px', sortable: false,
      render: (t: Transaction) => t.txHash
        ? <a href={`https://solscan.io/tx/${t.txHash}`} target="_blank" rel="noreferrer"
            style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--accent)', textDecoration: 'none' }}>
            {t.txHash.slice(0, 8)}…{t.txHash.slice(-4)}
          </a>
        : <span style={{ color: 'var(--muted)' }}>—</span>,
    },
  ]

  return (
    <div>
      <div className="page-header">
        <div className="page-title">ORCA Ledger</div>
        <div className="page-sub">ORCA token movements across all wallets</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map(e => (
            <button key={e} className={`entity-tab${entity === e ? ' active' : ''}`} onClick={() => setEntity(e)}>{e}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="status-bar"><span className="status-dot loading" /><span className="status-text">Loading ORCA ledger…</span></div>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <>
          <div className="cards-grid">
            <div className="card" style={{ borderTop: '3px solid #00A8A8' }}>
              <div className="card-label">ORCA In</div>
              <div className="card-value green">+{fmtNum(totalIn, 2)}</div>
              <div className="card-sub">{fmtUSD(totalUsdIn, 0)}</div>
            </div>
            <div className="card" style={{ borderTop: '3px solid #00A8A8' }}>
              <div className="card-label">ORCA Out</div>
              <div className="card-value red">-{fmtNum(totalOut, 2)}</div>
              <div className="card-sub">{fmtUSD(totalUsdOut, 0)}</div>
            </div>
            <div className="card" style={{ borderTop: '3px solid #00A8A8' }}>
              <div className="card-label">Net</div>
              <div className={`card-value ${totalIn - totalOut >= 0 ? 'green' : 'red'}`}>
                {totalIn - totalOut >= 0 ? '+' : ''}{fmtNum(totalIn - totalOut, 2)}
              </div>
              <div className="card-sub">{fmtUSD(totalUsdIn - totalUsdOut, 0)}</div>
            </div>
            <div className="card" style={{ borderTop: '3px solid #00A8A8' }}>
              <div className="card-label">Movements</div>
              <div className="card-value">{filtered.length}</div>
            </div>
          </div>

          <div className="section">
            <div className="section-header">
              <span className="section-title">{filtered.length} ORCA movements</span>
              <div className="section-filters">
                <select className="fsel" value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
                  <option value="">In + Out</option>
                  <option value="In">In</option>
                  <option value="Out">Out</option>
                </select>
                <select className="fsel" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
                  <option value="">All months</option>
                  {months.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>
                  {wallets.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
            </div>
            <DataTable data={filtered as unknown as Record<string, unknown>[]} columns={columns as any} defaultSort={{ col: 'date', dir: 'desc' }} maxHeight="600px" />
          </div>
        </>
      )}
    </div>
  )
}
