'use client'
import { useState, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES } from '@/lib/constants'
import { fmtUSD, fmtNum, fmtAddr, MONTH_SHORT_NAMES } from '@/lib/format'
import { useEntityWallets } from '@/lib/hooks/use-entity-wallets'
import { useTransactionMonths } from '@/lib/hooks/use-transaction-months'
import { Skeleton } from '@/components/skeleton'
import { DataTable } from '@/components/data-table'
import type { Transaction } from '@/lib/types'

export default function OrcaLedgerPage() {
  const [entity, setEntity] = useState('Opco')

  // Filters
  const [dirFilter, setDirFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')

  const swrKey = `/api/treasury/transactions?entity=${entity}&asset=ORCA&limit=all`
  const { data: txRes, isLoading, error: swrError } = useSWR<{ transactions: Transaction[]; total: number }>(
    swrKey,
    apiFetch<{ transactions: Transaction[]; total: number }>,
  )

  const transactions = txRes?.transactions ?? []
  const loading = isLoading
  const error = swrError ? (swrError instanceof Error ? swrError.message : String(swrError)) : null

  const { options: walletOptions } = useEntityWallets(entity)
  const { years: yearOptions, byYear: monthsByYear } = useTransactionMonths(entity, 'ORCA')

  // Stale-selection resets — drop a filter when its value falls out of the
  // available options (entity switch, wallet/data deletion, etc.).
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
    if (monthsForYear && !monthsForYear.includes(m)) setMonthFilter('')
  }, [monthFilter, monthsByYear])

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (dirFilter && t.dir !== dirFilter) return false
      if (walletFilter && t.walletAddr !== walletFilter) return false
      // t.date is an ISO UTC string; the months dropdown also buckets by UTC,
      // so compare on the UTC prefix to avoid a midnight-boundary mismatch.
      if (monthFilter && t.date.slice(0, 7) !== monthFilter) return false
      if (!monthFilter && yearFilter && t.date.slice(0, 4) !== yearFilter) return false
      return true
    })
  }, [transactions, dirFilter, walletFilter, yearFilter, monthFilter])

  const totalIn = filtered.filter(t => t.dir === 'In').reduce((s, t) => s + (t.qty || 0), 0)
  const totalOut = filtered.filter(t => t.dir === 'Out').reduce((s, t) => s + (t.qty || 0), 0)
  const totalUsdIn = filtered.filter(t => t.dir === 'In').reduce((s, t) => s + Math.abs(t.usd || 0), 0)
  const totalUsdOut = filtered.filter(t => t.dir === 'Out').reduce((s, t) => s + Math.abs(t.usd || 0), 0)

  const columns = [
    {
      key: 'date', label: 'Date', width: yearFilter ? '140px' : '160px',
      render: (t: Transaction) => {
        const d = new Date(t.date)
        return (
          <span style={{ fontSize: '0.72rem' }}>
            {d.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              ...(yearFilter ? {} : { year: 'numeric' }),
            })}
            {' '}
            <span style={{ color: 'var(--muted)', fontSize: '0.65rem' }}>
              {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </span>
        )
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
        <>
          <div className="cards-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card" style={{ borderTop: '3px solid var(--border)' }}>
                <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
                <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
                <Skeleton width={100} height={10} />
              </div>
            ))}
          </div>
          <div className="section">
            <div className="table-wrap" style={{ maxHeight: '600px', overflow: 'auto' }}>
              <table>
                <tbody>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 10px' }}><Skeleton width={90} height={12} /></td>
                      <td style={{ padding: '6px 10px' }}><Skeleton width={160} height={12} /></td>
                      <td style={{ padding: '6px 10px' }}><Skeleton width={30} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={70} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                      <td style={{ padding: '6px 10px' }}><Skeleton width={80} height={12} /></td>
                      <td style={{ padding: '6px 10px' }}><Skeleton width={70} height={12} /></td>
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
              </div>
            </div>
            <DataTable data={filtered as unknown as Record<string, unknown>[]} columns={columns as any} defaultSort={{ col: 'date', dir: 'desc' }} maxHeight="600px" />
          </div>
        </>
      )}
    </div>
  )
}
