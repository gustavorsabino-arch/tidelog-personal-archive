'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES } from '@/lib/constants'
import { fmtUSD, fmtNum, fmtAddr, MONTH_SHORT_NAMES } from '@/lib/format'
import { Skeleton } from '@/components/skeleton'
import { OrcaLedgerDrawer } from '@/components/orca-ledger-drawer'
import { CopyButton } from '@/components/copy-button'
import { exportOrcaLedgerXLSX } from '@/lib/orca-ledger-export'
import type { OrcaLedgerResponse, OrcaLedgerRow } from '@/lib/types'

interface Props {
  initialEntity: string
}

const rowKey = (r: OrcaLedgerRow) => `${r.txHash}::${r.walletAddr}::${r.dir}`

export function OrcaLedgerClient({ initialEntity }: Props) {
  const [entity, setEntity] = useState(initialEntity)
  const [dirFilter, setDirFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')
  const [openTxKey, setOpenTxKey] = useState<string | null>(null)

  // Reset filters when entity changes — different population entirely.
  useEffect(() => {
    setDirFilter(''); setTypeFilter(''); setYearFilter(''); setMonthFilter(''); setWalletFilter('')
    setOpenTxKey(null)
  }, [entity])

  const swrKey = `/api/treasury/orca-ledger?entity=${entity}`
  const { data, isLoading, error: swrError } = useSWR<OrcaLedgerResponse>(
    swrKey,
    apiFetch<OrcaLedgerResponse>,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  )
  const error = swrError ? (swrError instanceof Error ? swrError.message : String(swrError)) : null

  const rows = data?.rows ?? []
  const summaryByWallet = data?.summaryByWallet ?? {}

  // Filter option derivations
  const yearOptions = useMemo(() => {
    return Array.from(new Set(rows.map(r => r.date.slice(0, 4)))).sort().reverse()
  }, [rows])
  const monthsByYear = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const r of rows) {
      const y = r.date.slice(0, 4)
      const m = r.date.slice(5, 7)
      if (!map[y]) map[y] = []
      if (!map[y].includes(m)) map[y].push(m)
    }
    for (const y of Object.keys(map)) map[y].sort()
    return map
  }, [rows])
  const walletOptions = useMemo(() => {
    const opts = new Map<string, string>()
    for (const r of rows) opts.set(r.walletAddr, r.wallet)
    return Array.from(opts.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  // Stale-selection resets
  useEffect(() => { if (yearFilter && !yearOptions.includes(yearFilter)) { setYearFilter(''); setMonthFilter('') } }, [yearOptions, yearFilter])
  useEffect(() => {
    if (!monthFilter) return
    const [y, m] = monthFilter.split('-')
    if (!monthsByYear[y]?.includes(m)) setMonthFilter('')
  }, [monthsByYear, monthFilter])
  useEffect(() => { if (walletFilter && !walletOptions.some(o => o.value === walletFilter)) setWalletFilter('') }, [walletOptions, walletFilter])

  // Apply filters in order: type, dir, year, month, wallet
  const filtered = useMemo(() => rows.filter(r => {
    if (dirFilter && r.dir !== dirFilter) return false
    if (typeFilter === 'external' && (r.internal || r.priceSource === 'genesis')) return false
    if (typeFilter === 'internal' && !r.internal) return false
    if (typeFilter === 'genesis' && r.priceSource !== 'genesis') return false
    if (monthFilter && r.date.slice(0, 7) !== monthFilter) return false
    if (!monthFilter && yearFilter && r.date.slice(0, 4) !== yearFilter) return false
    if (walletFilter && r.walletAddr !== walletFilter) return false
    return true
  }), [rows, dirFilter, typeFilter, yearFilter, monthFilter, walletFilter])

  // Per-wallet last-row index for footer injection
  const lastIdxByWallet = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of filtered) map.set(r.walletAddr, rowKey(r))
    return map
  }, [filtered])

  // Card totals
  const totalIn = filtered.filter(r => r.dir === 'In').reduce((s, r) => s + r.qty, 0)
  const totalOut = filtered.filter(r => r.dir === 'Out').reduce((s, r) => s + r.qty, 0)
  const totalUsdIn = filtered.filter(r => r.dir === 'In').reduce((s, r) => s + (r.usd ?? 0), 0)
  const totalUsdOut = filtered.filter(r => r.dir === 'Out').reduce((s, r) => s + (r.usd ?? 0), 0)
  const lifetimeGL = Object.values(summaryByWallet).reduce((s, w) => s + w.lifetimeRealizedGain, 0)

  // Drawer state
  const openRow = openTxKey ? rows.find(r => rowKey(r) === openTxKey) ?? null : null
  const pairedRow = openRow?.internal && openRow.internalPairedWalletAddr
    ? rows.find(r => r.txHash === openRow.txHash && r.walletAddr === openRow.internalPairedWalletAddr) ?? null
    : null
  const openSummary = openRow ? summaryByWallet[openRow.walletAddr] ?? null : null
  const targetIsFiltered = openRow != null && !filtered.includes(openRow)

  // Click-to-jump
  const tableRef = useRef<HTMLDivElement>(null)
  function jumpTo(targetKey: string) {
    setOpenTxKey(targetKey)
    requestAnimationFrame(() => {
      const el = tableRef.current?.querySelector(`[data-row-key="${CSS.escape(targetKey)}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('row-highlight')
        setTimeout(() => el.classList.remove('row-highlight'), 1500)
      }
    })
  }

  function handleShowInTable() {
    setDirFilter('')
    setTypeFilter('')
    setYearFilter('')
    setMonthFilter('')
    setWalletFilter('')
    // After React flushes the filter clear, retry the scroll/highlight on
    // the now-visible row. Double rAF ensures the table has re-rendered.
    if (!openTxKey) return
    const targetKey = openTxKey
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = tableRef.current?.querySelector(`[data-row-key="${CSS.escape(targetKey)}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('row-highlight')
        setTimeout(() => el.classList.remove('row-highlight'), 1500)
      }
    }))
  }

  function handleExport() {
    if (!data) return
    exportOrcaLedgerXLSX({
      rows: filtered,
      summaryByWallet,
      computedAt: data.computedAt,
      entity,
      activeFilters: { dir: dirFilter, type: typeFilter, year: yearFilter, month: monthFilter, wallet: walletFilter },
    })
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">ORCA Ledger</div>
        <div className="page-sub">ORCA token movements with FIFO trace</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map(e => (
            <button key={e} className={`entity-tab${entity === e ? ' active' : ''}`} onClick={() => setEntity(e)}>{e}</button>
          ))}
        </div>
      </div>

      {isLoading ? <LoadingSkeleton /> : error ? <div className="error-msg">{error}</div> : (
        <>
          {/* Cards */}
          <div className="cards-grid">
            <Card label="ORCA In" value={`+${fmtNum(totalIn, 2)}`} sub={fmtUSD(totalUsdIn, 0)} className="green" />
            <Card label="ORCA Out" value={`-${fmtNum(totalOut, 2)}`} sub={fmtUSD(totalUsdOut, 0)} className="red" />
            <Card label="Net" value={`${totalIn - totalOut >= 0 ? '+' : ''}${fmtNum(totalIn - totalOut, 2)}`} sub={fmtUSD(totalUsdIn - totalUsdOut, 0)} className={totalIn - totalOut >= 0 ? 'green' : 'red'} />
            <Card label="Movements" value={String(filtered.length)} />
            <Card label="Lifetime Realized G/L" value={fmtUSD(lifetimeGL, 0)} className={lifetimeGL >= 0 ? 'green' : 'red'} />
          </div>

          {/* Filters + export */}
          <div className="section">
            <div className="section-header">
              <span className="section-title">{filtered.length} ORCA movements</span>
              <div className="section-filters">
                <select className="fsel" value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
                  <option value="">In + Out</option><option value="In">In</option><option value="Out">Out</option>
                </select>
                <select className="fsel" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                  <option value="">All types</option><option value="external">External</option><option value="internal">Internal</option><option value="genesis">Genesis</option>
                </select>
                <select className="fsel" value={yearFilter} onChange={e => { setYearFilter(e.target.value); setMonthFilter('') }}>
                  <option value="">All years</option>{yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select className="fsel" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} disabled={!yearFilter}>
                  <option value="">{yearFilter ? 'All months' : 'Select year first'}</option>
                  {yearFilter && (monthsByYear[yearFilter] ?? []).map(m => (
                    <option key={m} value={`${yearFilter}-${m}`}>{MONTH_SHORT_NAMES[Number(m) - 1]}</option>
                  ))}
                </select>
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>{walletOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button onClick={handleExport} disabled={filtered.length === 0} style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', cursor: filtered.length ? 'pointer' : 'not-allowed' }}>⬇ Export Excel</button>
              </div>
            </div>

            <div ref={tableRef} className="table-wrap" style={{ maxHeight: 600, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Wallet</th><th>Dir</th><th className="num">Qty</th>
                    <th className="num">Price</th><th className="num">USD</th><th className="num">Balance</th>
                    <th>Counterparty</th><th>Type</th><th>Lots</th><th className="num">G/L</th><th>Tx</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const k = rowKey(r)
                    const summary = lastIdxByWallet.get(r.walletAddr) === k ? summaryByWallet[r.walletAddr] : null
                    return [
                      <LedgerRow key={k} row={r} rowKey={k} onOpen={setOpenTxKey} />,
                      summary ? <SummaryFooterRow key={`${k}-summary`} summary={summary} /> : null,
                    ]
                  })}
                </tbody>
              </table>
            </div>

            {data?.computedAt && (
              <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: 8, textAlign: 'right', fontFamily: 'var(--mono)' }}>
                Computed: {new Date(data.computedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
              </div>
            )}
          </div>
        </>
      )}

      <OrcaLedgerDrawer
        row={openRow}
        pairedRow={pairedRow}
        walletSummary={openSummary}
        onClose={() => setOpenTxKey(null)}
        onJumpTo={jumpTo}
        targetIsFiltered={targetIsFiltered}
        onShowInTable={handleShowInTable}
      />
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────────────
function Card({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="card" style={{ borderTop: '3px solid #00A8A8' }}>
      <div className="card-label">{label}</div>
      <div className={`card-value ${className ?? ''}`}>{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  )
}

function LedgerRow({ row, rowKey: k, onOpen }: { row: OrcaLedgerRow; rowKey: string; onOpen: (k: string) => void }) {
  const isGenesis = row.priceSource === 'genesis'
  const typePill = isGenesis
    ? { label: 'GENESIS',  bg: 'var(--orange-bg)',  fg: 'var(--orange)',  border: 'color-mix(in srgb, var(--orange) 25%, transparent)' }
    : row.internal
      ? { label: 'INTERNAL', bg: 'var(--accent-bg)', fg: 'var(--accent)', border: 'color-mix(in srgb, var(--accent) 25%, transparent)' }
      : { label: 'EXTERNAL', bg: 'transparent',     fg: 'var(--muted)',  border: 'var(--border)' }
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <tr data-row-key={k} onClick={() => onOpen(k)} style={{ cursor: 'pointer' }}>
      <td style={{ fontSize: '0.72rem' }}>
        {new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </td>
      <td style={{ lineHeight: 1.4 }}>
        <span style={{ fontSize: '0.72rem' }}>{row.wallet.slice(0, 20)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }} onClick={stop}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--muted)' }}>{fmtAddr(row.walletAddr)}</span>
          <CopyButton address={row.walletAddr} />
        </div>
      </td>
      <td className={row.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ fontWeight: 700, textAlign: 'center', fontSize: '1rem' }}>{row.dir === 'In' ? '↑' : '↓'}</td>
      <td className={row.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.72rem' }}>{row.dir === 'In' ? '+' : '-'}{fmtNum(row.qty, 2)}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.72rem' }}>{row.price ? `$${row.price.toFixed(4)}` : '—'}</td>
      <td className={row.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.72rem' }}>{row.usd != null ? fmtUSD(row.usd) : '—'}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.72rem', color: row.balanceAfter < 0 ? 'var(--red)' : 'var(--text)' }}>{fmtNum(row.balanceAfter, 2)}</td>
      <td style={{ lineHeight: 1.4 }}>
        {(() => {
          const addr = row.counterparty ?? row.internalPairedWalletAddr
          const label = row.counterpartyLabel ?? row.internalPairedWalletLabel
          if (!addr) return <span style={{ color: 'var(--muted)' }}>—</span>
          return (
            <>
              <span style={{ fontSize: '0.7rem' }}>{label ?? fmtAddr(addr, 6)}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }} onClick={stop}>
                <a href={`https://solscan.io/account/${addr}`} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--muted)', textDecoration: 'none' }}>{fmtAddr(addr, 6)}</a>
                <CopyButton address={addr} />
              </div>
            </>
          )
        })()}
      </td>
      <td>
        <span style={{
          fontFamily: 'var(--mono)',
          fontSize: '0.65rem',
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 3,
          background: typePill.bg,
          color: typePill.fg,
          border: `1px solid ${typePill.border}`,
        }}>{typePill.label}</span>
      </td>
      <td style={{ fontFamily: 'var(--mono)', fontSize: '0.67rem' }}><LotsCell row={row} /></td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.7rem', fontWeight: 600 }}>
        {row.dir === 'Out' && row.lots.length > 0 ? (
          <span className={row.realizedGain > 0 ? 'gain-pos' : row.realizedGain < 0 ? 'gain-neg' : ''}>
            {row.realizedGain > 0 ? '+' : ''}{fmtUSD(row.realizedGain)}
            {row.realizedTerm && <span style={{ fontSize: '0.58rem', color: 'var(--muted)', marginLeft: 3 }}>{row.realizedTerm.toUpperCase()}</span>}
          </span>
        ) : ''}
      </td>
      <td>
        {isGenesis
          ? <span style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--muted2)' }}>{row.txHash.slice(0, 8)}…</span>
          : <a onClick={stop} href={`https://solscan.io/tx/${row.txHash}`} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--accent)' }}>{row.txHash.slice(0, 8)}…</a>}
      </td>
      <td style={{ color: 'var(--muted)', textAlign: 'right' }}>›</td>
    </tr>
  )
}

function LotsCell({ row }: { row: OrcaLedgerRow }) {
  if (row.dir === 'Out' && row.noBasis) return <span style={{ color: 'var(--red)' }}>⚠ no basis</span>
  if (row.dir === 'In' && row.internal) return <span style={{ color: '#6af' }}>↤ {fmtNum(row.lots[0]?.qty ?? 0, 2)} @ ${row.lots[0]?.costPerUnit?.toFixed(4) ?? '—'}</span>
  if (row.dir === 'In') return <span style={{ color: 'var(--green)' }}>+ lot @ ${row.lots[0]?.costPerUnit?.toFixed(4) ?? '—'}</span>
  if (row.internal) return <span style={{ color: '#6af' }}>↦ {fmtNum(row.qty, 2)}</span>
  if (row.lots.length <= 2) return <span style={{ color: 'var(--muted)' }}>{row.lots.map(l => `${fmtNum(l.qty, 2)}@$${l.costPerUnit.toFixed(4)}`).join(' · ')}</span>
  const totalQty = row.lots.reduce((s, l) => s + l.qty, 0)
  const totalCost = row.lots.reduce((s, l) => s + l.qty * l.costPerUnit, 0)
  return <span style={{ color: 'var(--muted)' }}>{row.lots.length} lots · avg ${(totalQty > 0 ? totalCost / totalQty : 0).toFixed(4)}</span>
}

function SummaryFooterRow({ summary }: { summary: import('@/lib/types').OrcaWalletSummary }) {
  return (
    <tr style={{ background: 'rgba(255,255,255,0.04)', borderTop: '1px solid var(--border)' }}>
      <td colSpan={2} style={{ fontSize: '0.65rem', color: 'var(--muted)', padding: '4px 8px', fontStyle: 'italic' }}>remaining balance · {summary.wallet}</td>
      <td></td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.72rem', fontWeight: 700, color: summary.noBasis ? 'var(--red)' : 'var(--green)' }}>{fmtNum(summary.totalQty, 2)}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>{summary.noBasis ? '—' : `$${summary.avgCostPerUnit.toFixed(4)} avg`}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>{summary.noBasis ? '—' : fmtUSD(summary.totalQty * summary.avgCostPerUnit)}</td>
      <td colSpan={3}></td>
      <td style={{ fontSize: '0.63rem', color: 'var(--muted)' }}>{summary.remainingLots.length} open lot{summary.remainingLots.length === 1 ? '' : 's'}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.7rem', color: summary.lifetimeRealizedGain >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {summary.lifetimeRealizedGain >= 0 ? '+' : ''}{fmtUSD(summary.lifetimeRealizedGain)}
        <br /><span style={{ fontSize: '0.58rem', color: 'var(--muted)', fontWeight: 400 }}>realized</span>
      </td>
      <td colSpan={2}></td>
    </tr>
  )
}

function LoadingSkeleton() {
  return (
    <>
      <div className="cards-grid">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="card" style={{ borderTop: '3px solid var(--border)' }}>
            <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
            <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
            <Skeleton width={100} height={10} />
          </div>
        ))}
      </div>
      <div className="section">
        <div className="table-wrap" style={{ maxHeight: 600, overflow: 'auto' }}>
          <table><tbody>{[0, 1, 2, 3, 4].map(i => (
            <tr key={i}>
              {Array.from({ length: 12 }).map((_, j) => <td key={j} style={{ padding: '6px 10px' }}><Skeleton width={80} height={12} /></td>)}
            </tr>
          ))}</tbody></table>
        </div>
      </div>
    </>
  )
}
