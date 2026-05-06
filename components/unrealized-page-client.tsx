'use client'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES, ENTITY_COLORS, TOKEN_COLORS } from '@/lib/constants'
import { fmtUSD, fmtNum, fmtDate, MONTH_SHORT_NAMES } from '@/lib/format'
import { Skeleton } from '@/components/skeleton'
import { CopyButton } from '@/components/copy-button'
import { exportUnrealizedXLSX } from '@/lib/unrealized-export'
import type {
  UnrealizedResponse,
  UnrealizedPosition,
  UnrealizedLot,
} from '@/lib/types'

interface Props {
  initialEntity: string
}

const groupKey = (p: { walletAddr: string; asset: string }) => `${p.walletAddr}::${p.asset}`

const ENTITY_TABS = ['All', ...ENTITIES] as const

export function UnrealizedPageClient({ initialEntity }: Props) {
  const [entity, setEntity] = useState(initialEntity)
  const [tokenFilter, setTokenFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')
  // Year + month picked separately: year is a UI disclosure that narrows the
  // month list. Snapshot triggers only when both are set; year-alone stays live.
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('') // 'MM' within yearFilter
  const [signFilter, setSignFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Reset filters and expansion when the entity changes — different population.
  useEffect(() => {
    setTokenFilter(''); setWalletFilter(''); setYearFilter(''); setMonthFilter(''); setSignFilter('')
    setExpanded(new Set())
  }, [entity])

  const asOf = yearFilter && monthFilter ? `${yearFilter}-${monthFilter}` : ''
  const swrKey = `/api/treasury/unrealized?entity=${entity}${asOf ? `&asOf=${asOf}` : ''}`
  const { data, isLoading, error: swrError } = useSWR<UnrealizedResponse>(
    swrKey,
    apiFetch<UnrealizedResponse>,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  )
  const error = swrError ? (swrError instanceof Error ? swrError.message : String(swrError)) : null

  const positions = data?.positions ?? []
  const lots = data?.lots ?? []
  const tokenOptions = data?.tokenOptions ?? []
  const walletOptions = data?.walletOptions ?? []
  const months = data?.monthsAvailable ?? []
  const missingPrices = data?.missingPrices ?? []
  const isSnapshot = !!data?.asOf
  const isAll = entity === 'All'

  const yearOptions = useMemo(
    () => [...new Set(months.map((ym) => ym.slice(0, 4)))].sort().reverse(),
    [months],
  )
  const monthsByYear = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const ym of months) {
      const y = ym.slice(0, 4)
      const m = ym.slice(5, 7)
      if (!map[y]) map[y] = []
      map[y].push(m)
    }
    for (const y of Object.keys(map)) map[y].sort().reverse()
    return map
  }, [months])

  // Drop stale filter selections after entity-change response arrives.
  useEffect(() => {
    if (tokenFilter && tokenOptions.length > 0 && !tokenOptions.includes(tokenFilter)) setTokenFilter('')
  }, [tokenOptions, tokenFilter])
  useEffect(() => {
    if (walletFilter && walletOptions.length > 0 && !walletOptions.some(w => w.walletAddr === walletFilter)) setWalletFilter('')
  }, [walletOptions, walletFilter])
  useEffect(() => {
    if (yearFilter && yearOptions.length > 0 && !yearOptions.includes(yearFilter)) {
      setYearFilter(''); setMonthFilter('')
    }
  }, [yearOptions, yearFilter])
  useEffect(() => {
    if (!monthFilter) return
    if (!yearFilter || !monthsByYear[yearFilter]?.includes(monthFilter)) setMonthFilter('')
  }, [monthsByYear, yearFilter, monthFilter])

  const filtered = useMemo(() => positions.filter(p => {
    if (tokenFilter && p.asset !== tokenFilter) return false
    if (walletFilter && p.walletAddr !== walletFilter) return false
    if (signFilter === '+' && (p.unrealGain == null || p.unrealGain < 0)) return false
    if (signFilter === '-' && (p.unrealGain == null || p.unrealGain >= 0)) return false
    return true
  }), [positions, tokenFilter, walletFilter, signFilter])

  // Map of (walletAddr, asset) → sorted lots (for expansion + export).
  const lotsByGroup = useMemo(() => {
    const map = new Map<string, UnrealizedLot[]>()
    for (const lot of lots) {
      const key = groupKey(lot)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(lot)
    }
    for (const list of map.values()) list.sort((a, b) => a.acqDate.localeCompare(b.acqDate))
    return map
  }, [lots])

  // Summary card totals (recomputed from filtered).
  const totalUnreal = filtered.reduce((s, p) => s + (p.unrealGain ?? 0), 0)
  const totalCost = filtered.reduce((s, p) => s + p.costBasis, 0)
  const totalValue = filtered.reduce((s, p) => s + (p.currentValue ?? 0), 0)
  const totalPriorValue = filtered.reduce((s, p) => s + (p.priorValue ?? 0), 0)
  const totalDelta = filtered.reduce((s, p) => s + (p.deltaMonth ?? 0), 0)
  const returnPct = totalCost > 0 ? (totalUnreal / totalCost) * 100 : 0

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleExport() {
    if (!data) return
    exportUnrealizedXLSX({
      positions: filtered,
      lots: filtered.flatMap(p => lotsByGroup.get(groupKey(p)) ?? []),
      computedAt: data.computedAt,
      entity,
      asOf: data.asOf,
      activeFilters: { token: tokenFilter, wallet: walletFilter, month: asOf, sign: signFilter },
    })
  }

  // Base columns: Wallet, Token, Acq, Cost $, Qty, Cost Basis, Current $,
  // Current Val, Unrealized, %. Snapshot mode adds Prior Val and Δ Month.
  const colCount = 10 + (isSnapshot ? 2 : 0) + (isAll ? 1 : 0)

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Unrealized</div>
        <div className="page-sub">Open positions — FIFO cost basis vs {isSnapshot ? 'end-of-month' : 'live'} price</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITY_TABS.map(e => (
            <button key={e} className={`entity-tab${entity === e ? ' active' : ''}`} onClick={() => setEntity(e)}>{e}</button>
          ))}
        </div>
      </div>

      {isLoading ? <LoadingSkeleton /> : error ? <div className="error-msg">{error}</div> : (
        <>
          {missingPrices.length > 0 && (
            <div className="error-msg" style={{ marginBottom: 12 }}>
              No price source for: {missingPrices.join(', ')}. Affected positions show — and are excluded from totals.
            </div>
          )}

          <div className="cards-grid">
            <Card label="Unrealized G/L" value={`${totalUnreal >= 0 ? '+' : ''}${fmtUSD(totalUnreal)}`} className={totalUnreal >= 0 ? 'green' : 'red'} />
            <Card label="Cost Basis" value={fmtUSD(totalCost)} />
            <Card label={isSnapshot ? 'Value @ EOM' : 'Current Value'} value={fmtUSD(totalValue)} className="blue" />
            <Card label="Return" value={`${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`} className={returnPct >= 0 ? 'green' : 'red'} />
            <Card label="Positions" value={String(filtered.length)} />
            {isSnapshot && (
              <>
                <Card label="Prior Val" value={fmtUSD(totalPriorValue)} />
                <Card label="Δ Month" value={`${totalDelta >= 0 ? '+' : ''}${fmtUSD(totalDelta)}`} className={totalDelta >= 0 ? 'green' : 'red'} />
              </>
            )}
          </div>

          <div className="section">
            <div className="section-header">
              <span className="section-title">{filtered.length} open position{filtered.length === 1 ? '' : 's'}{isSnapshot && data?.asOf ? ` · ${fmtMonthLabel(asOf)}` : ''}</span>
              <div className="section-filters">
                <select className="fsel" value={tokenFilter} onChange={e => setTokenFilter(e.target.value)}>
                  <option value="">All tokens</option>
                  {tokenOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>
                  {walletOptions.map(w => <option key={w.walletAddr} value={w.walletAddr}>{w.wallet}</option>)}
                </select>
                <select className="fsel" value={yearFilter} onChange={e => { setYearFilter(e.target.value); setMonthFilter('') }}>
                  <option value="">Live</option>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select className="fsel" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} disabled={!yearFilter}>
                  <option value="">{yearFilter ? 'Pick month' : 'Select year first'}</option>
                  {yearFilter && (monthsByYear[yearFilter] ?? []).map(m => (
                    <option key={m} value={m}>{MONTH_SHORT_NAMES[Number(m) - 1]}</option>
                  ))}
                </select>
                <select className="fsel" value={signFilter} onChange={e => setSignFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="+">Gains only</option>
                  <option value="-">Losses only</option>
                </select>
                <button onClick={handleExport} disabled={filtered.length === 0} style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', cursor: filtered.length ? 'pointer' : 'not-allowed' }}>⬇ Export Excel</button>
              </div>
            </div>

            <div className="table-wrap" style={{ maxHeight: 600, overflowX: 'auto', overflowY: 'auto' }}>
              <table style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th className="sticky-first">Wallet</th>
                    {isAll && <th>Entity</th>}
                    <th>Token</th>
                    <th>Acquired</th>
                    <th className="num">Cost $</th>
                    <th className="num">Qty</th>
                    <th className="num">Cost Basis</th>
                    <th className="num">Current $</th>
                    <th className="num">{isSnapshot ? 'Value @ EOM' : 'Current Val'}</th>
                    {isSnapshot && <th className="num">Prior Val</th>}
                    {isSnapshot && <th className="num">Δ Month</th>}
                    <th className="num">Unrealized</th>
                    <th className="num">%</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={colCount} style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
                      No unrealized positions for this filter.
                    </td></tr>
                  ) : filtered.map(p => {
                    const k = groupKey(p)
                    const isOpen = expanded.has(k)
                    const groupLots = lotsByGroup.get(k) ?? []
                    return [
                      <PositionRow key={k} p={p} isOpen={isOpen} hasMultipleLots={p.lotCount > 1} onToggle={() => toggleExpand(k)} isSnapshot={isSnapshot} showEntity={isAll} />,
                      ...(isOpen ? groupLots.map((lot, i) => (
                        <LotRow key={`${k}::lot::${i}`} lot={lot} isSnapshot={isSnapshot} showEntity={isAll} />
                      )) : []),
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
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function Card({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className={`card-value ${className ?? ''}`}>{value}</div>
    </div>
  )
}

function PositionRow({ p, isOpen, hasMultipleLots, onToggle, isSnapshot, showEntity }: {
  p: UnrealizedPosition
  isOpen: boolean
  hasMultipleLots: boolean
  onToggle: () => void
  isSnapshot: boolean
  showEntity: boolean
}) {
  const c = TOKEN_COLORS[p.asset] || '#888'
  const ec = ENTITY_COLORS[p.entity] || 'var(--muted)'
  const noPrice = p.currentPrice == null
  return (
    <tr style={{ cursor: hasMultipleLots ? 'pointer' : 'default' }} onClick={hasMultipleLots ? onToggle : undefined}>
      <td className="label sticky-first" style={{ maxWidth: 220 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0 }}>
          <span style={{ width: 14, color: 'var(--muted)', flexShrink: 0, textAlign: 'center' }}>
            {hasMultipleLots ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span title={p.wallet} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{p.wallet}</span>
          <CopyButton address={p.walletAddr} />
        </span>
      </td>
      {showEntity && (
        <td>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${ec}18`, color: ec }}>{p.entity}</span>
        </td>
      )}
      <td>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${c}18`, color: c }}>{p.asset}</span>
      </td>
      <td style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{fmtAcqRange(p.acqDateMin, p.acqDateMax)}</td>
      <td className="num" style={{ color: 'var(--muted)' }}>${p.avgCostPerUnit.toFixed(p.asset === 'ORCA' ? 4 : 2)}</td>
      <td className="num">{fmtNum(p.qty, p.asset === 'SOL' ? 4 : 2)}</td>
      <td className="num">{fmtUSD(p.costBasis)}</td>
      <td className="num" style={{ color: noPrice ? 'var(--red)' : 'var(--muted)' }}>{noPrice ? 'no price' : `$${p.currentPrice!.toFixed(p.asset === 'ORCA' ? 4 : 2)}`}</td>
      <td className="num">{p.currentValue == null ? '—' : fmtUSD(p.currentValue)}</td>
      {isSnapshot && <td className="num">{p.priorValue == null ? '—' : fmtUSD(p.priorValue)}</td>}
      {isSnapshot && <td className={`num ${(p.deltaMonth ?? 0) >= 0 ? 'gain-pos' : 'gain-neg'}`}>{p.deltaMonth == null ? '—' : `${p.deltaMonth >= 0 ? '+' : ''}${fmtUSD(p.deltaMonth)}`}</td>}
      <td className={`num ${(p.unrealGain ?? 0) >= 0 ? 'gain-pos' : 'gain-neg'}`} style={{ fontWeight: 600 }}>
        {p.unrealGain == null ? '—' : `${p.unrealGain >= 0 ? '+' : ''}${fmtUSD(p.unrealGain)}`}
      </td>
      <td className={`num ${(p.returnPct ?? 0) >= 0 ? 'gain-pos' : 'gain-neg'}`}>{p.returnPct == null ? '—' : `${p.returnPct >= 0 ? '+' : ''}${p.returnPct.toFixed(2)}%`}</td>
    </tr>
  )
}

function LotRow({ lot, isSnapshot, showEntity }: { lot: UnrealizedLot; isSnapshot: boolean; showEntity: boolean }) {
  const noPrice = lot.currentPrice == null
  return (
    <tr style={{ background: 'rgba(255,255,255,0.03)', fontSize: '0.7rem' }}>
      <td className="sticky-first" style={{ paddingLeft: 32, color: 'var(--muted)', fontStyle: 'italic' }}>lot</td>
      {showEntity && <td></td>}
      <td></td>
      <td style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{fmtDate(lot.acqDate)}</td>
      <td className="num" style={{ color: 'var(--muted)' }}>${lot.costPerUnit.toFixed(lot.asset === 'ORCA' ? 4 : 2)}</td>
      <td className="num">{fmtNum(lot.qty, lot.asset === 'SOL' ? 4 : 2)}</td>
      <td className="num">{fmtUSD(lot.costBasis)}</td>
      <td className="num" style={{ color: noPrice ? 'var(--red)' : 'var(--muted)' }}>{noPrice ? 'no price' : `$${lot.currentPrice!.toFixed(lot.asset === 'ORCA' ? 4 : 2)}`}</td>
      <td className="num">{lot.currentValue == null ? '—' : fmtUSD(lot.currentValue)}</td>
      {isSnapshot && <td className="num" style={{ color: 'var(--muted)' }}>—</td>}
      {isSnapshot && <td className="num" style={{ color: 'var(--muted)' }}>—</td>}
      <td className={`num ${(lot.unrealGain ?? 0) >= 0 ? 'gain-pos' : 'gain-neg'}`}>
        {lot.unrealGain == null ? '—' : `${lot.unrealGain >= 0 ? '+' : ''}${fmtUSD(lot.unrealGain)}`}
      </td>
      <td className={`num ${(lot.returnPct ?? 0) >= 0 ? 'gain-pos' : 'gain-neg'}`}>{lot.returnPct == null ? '—' : `${lot.returnPct >= 0 ? '+' : ''}${lot.returnPct.toFixed(2)}%`}</td>
    </tr>
  )
}

function LoadingSkeleton() {
  return (
    <>
      <div className="cards-grid">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="card">
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
              {Array.from({ length: 12 }).map((_, j) => <td key={j} style={{ padding: '6px 10px' }}><Skeleton width={70} height={12} /></td>)}
            </tr>
          ))}</tbody></table>
        </div>
      </div>
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMonthLabel(yyyymm: string): string {
  if (!/^\d{4}-\d{2}$/.test(yyyymm)) return yyyymm
  const [y, m] = yyyymm.split('-').map(Number)
  return `${MONTH_SHORT_NAMES[m - 1]} ${y}`
}

function fmtAcqRange(min: string, max: string): string {
  if (min === max) return fmtDate(min)
  return `${fmtDate(min)} → ${fmtDate(max)}`
}
