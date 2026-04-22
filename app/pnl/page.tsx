'use client'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES, ENTITY_COLORS } from '@/lib/constants'
import { fmtUSD } from '@/lib/format'
import { Skeleton } from '@/components/skeleton'
import type { PnlAccount, PnlSection, PnlTree } from '@/lib/qb/pnl'

type PnlResponse = PnlTree & {
  entity: string
  periodStart: string
  periodEnd: string
  fetchedAt: string
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

type Mode = 'month' | 'ytd'

function getCurrentPeriod(): { year: number; month: number } {
  const now = new Date()
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
}

function toRange(mode: Mode, year: number, month: number): { start: string; end: string; label: string } {
  const mm = String(month).padStart(2, '0')
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
  const start = mode === 'ytd' ? `${year}-01-01` : `${year}-${mm}-01`
  const label = mode === 'ytd' ? `Jan – ${MONTH_NAMES[month - 1]} ${year}` : `${MONTH_NAMES[month - 1]} ${year}`
  return { start, end, label }
}

function sectionColor(sectionKind: PnlSection['sectionKind']): string {
  if (sectionKind === 'expense' || sectionKind === 'other-expense') return 'var(--red)'
  if (sectionKind === 'other-income') return '#06A0C4'
  return 'var(--green)'
}

function PnlRow({ node, depth }: { node: PnlSection | PnlAccount; depth: number }) {
  if (node.kind === 'account') {
    return (
      <tr>
        <td style={{ padding: '6px 10px', paddingLeft: depth * 16 + 10 }}>
          {node.glCode ? (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: '0.7rem', background: 'var(--surface2)',
              color: 'var(--accent)', padding: '1px 6px', borderRadius: 4, marginRight: 8,
            }}>{node.glCode}</span>
          ) : null}
          <span>{node.glCode ? node.label.replace(/^\d{4,}\s*·?\s*/, '') : node.label}</span>
        </td>
        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtUSD(node.amount)}</td>
      </tr>
    )
  }

  return (
    <>
      <tr>
        <td colSpan={2} style={{
          padding: '8px 10px', paddingLeft: depth * 16 + 10,
          fontWeight: 600, fontSize: '0.85rem', color: sectionColor(node.sectionKind),
          borderTop: '1px solid var(--border)',
        }}>
          {node.title}
          <span style={{ float: 'right', color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmtUSD(node.total)}</span>
        </td>
      </tr>
      {node.children.map((child, i) => (
        <PnlRow key={i} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

export default function PnLPage() {
  const current = useMemo(getCurrentPeriod, [])
  const [entity, setEntity] = useState<(typeof ENTITIES)[number]>('Opco')
  const [mode, setMode] = useState<Mode>('ytd')
  const [year, setYear] = useState(current.year)
  const [month, setMonth] = useState(current.month)

  const period = useMemo(() => toRange(mode, year, month), [mode, year, month])

  const swrKey = `/api/qb/pnl?entity=${entity}&periodStart=${period.start}&periodEnd=${period.end}`
  const { data, isLoading, error: swrError, mutate } = useSWR<PnlResponse>(
    swrKey,
    apiFetch<PnlResponse>,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  )
  const loading = isLoading
  const error = swrError ? (swrError instanceof Error ? swrError.message : String(swrError)) : null

  const totals = data?.totals
  const netClass = (totals?.netIncome ?? 0) >= 0 ? 'green' : 'red'

  return (
    <div>
      <div className="page-header">
        <div className="page-title">P&amp;L</div>
        <div className="page-sub">Profit &amp; loss reports from QuickBooks</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map((e) => (
            <button
              key={e}
              className={`entity-tab${entity === e ? ' active' : ''}`}
              onClick={() => setEntity(e)}
              style={entity === e ? { color: ENTITY_COLORS[e] } : undefined}
            >
              {e}
            </button>
          ))}
        </div>
        <select className="fsel" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="ytd">YTD</option>
          <option value="month">Month</option>
        </select>
        <select className="fsel" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[current.year - 1, current.year, current.year + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select className="fsel" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTH_NAMES.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        {loading ? <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Loading…</span> : null}
      </div>

      {loading && !data ? (
        <div className="cards-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card">
              <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
              <Skeleton width={140} height={22} />
            </div>
          ))}
        </div>
      ) : (
      <div className="cards-grid">
        <div className="card">
          <div className="card-label">Total Revenue</div>
          <div className="card-value green">{fmtUSD(totals?.revenue ?? 0)}</div>
        </div>
        <div className="card">
          <div className="card-label">Total Expenses</div>
          <div className="card-value red">{fmtUSD(Math.abs(totals?.expense ?? 0))}</div>
        </div>
        <div className="card">
          <div className="card-label">Net Income</div>
          <div className={`card-value ${netClass}`}>
            {(totals?.netIncome ?? 0) >= 0 ? '+' : ''}{fmtUSD(totals?.netIncome ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Period</div>
          <div className="card-value" style={{ fontSize: '0.9rem' }}>{period.label}</div>
        </div>
      </div>
      )}

      {loading && !data ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td style={{ padding: '6px 10px' }}><Skeleton width={160} height={12} /></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={90} height={12} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : error ? (
        <div className="empty">
          <div className="empty-icon">⚠️</div>
          <div>{error}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>
            Connect {entity} via the Budget → Settings → QuickBooks panel, then retry.
          </div>
        </div>
      ) : data && data.sections.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📊</div>
          <div>No P&amp;L data for this period.</div>
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px', textAlign: 'left', fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account</th>
                <th style={{ padding: '10px', textAlign: 'right', fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data?.sections.map((section, i) => (
                <PnlRow key={i} node={section} depth={0} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
