'use client'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES, ENTITY_COLORS } from '@/lib/constants'
import { fmtUSD } from '@/lib/format'
import { Skeleton } from '@/components/skeleton'
import type { PnlAccount, PnlSection, PnlTree } from '@/lib/qb/pnl'
import type { QboEntity } from '@/lib/qb/config'
import { GlDrillDrawer } from './gl-drill-drawer'
import type { GlDrillScope } from '@/lib/qb/gl-data'

type PnlResponse = PnlTree & {
  entity: string
  periodStart: string
  periodEnd: string
  fetchedAt: string
  partialEntities: string[]
}

type EntityChoice = QboEntity | 'All'

const ENTITY_TABS: EntityChoice[] = ['All', ...ENTITIES]

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

type Mode = 'month' | 'ytd'

type DrillState = {
  entity: GlDrillScope
  accountNumber: string
  accountLabel: string
  periodStart: string
  periodEnd: string
}

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

function PnlRow({
  node, depth, onGlClick,
}: {
  node: PnlSection | PnlAccount
  depth: number
  onGlClick: (glCode: string, label: string) => void
}) {
  if (node.kind === 'account') {
    const handleClick = node.glCode ? () => onGlClick(node.glCode!, node.label) : undefined
    return (
      <tr>
        <td style={{ paddingTop: 6, paddingRight: 10, paddingBottom: 6, paddingLeft: depth * 16 + 10 }}>
          {node.glCode ? (
            <button
              className="gl-badge-button"
              onClick={handleClick}
              title="View transactions"
            >{node.glCode}</button>
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
          paddingTop: 8, paddingRight: 10, paddingBottom: 8, paddingLeft: depth * 16 + 10,
          fontWeight: 600, fontSize: '0.85rem', color: sectionColor(node.sectionKind),
          borderTop: '1px solid var(--border)',
        }}>
          {node.title}
          <span style={{ float: 'right', color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmtUSD(node.total)}</span>
        </td>
      </tr>
      {node.children.map((child, i) => (
        <PnlRow key={i} node={child} depth={depth + 1} onGlClick={onGlClick} />
      ))}
    </>
  )
}

export default function PnLPage() {
  const current = useMemo(getCurrentPeriod, [])
  const [entity, setEntity] = useState<EntityChoice>('Opco')
  const [mode, setMode] = useState<Mode>('ytd')
  const [year, setYear] = useState(current.year)
  const [month, setMonth] = useState(current.month)
  const [drill, setDrill] = useState<DrillState | null>(null)

  const period = useMemo(() => toRange(mode, year, month), [mode, year, month])

  const swrKey = `/api/qb/pnl?entity=${entity}&periodStart=${period.start}&periodEnd=${period.end}`
  const { data, isLoading, error: swrError } = useSWR<PnlResponse>(
    swrKey,
    apiFetch<PnlResponse>,
  )
  const error = swrError ? (swrError instanceof Error ? swrError.message : String(swrError)) : null

  const isCurrentData =
    !!data &&
    data.entity === entity &&
    data.periodStart === period.start &&
    data.periodEnd === period.end
  const loading = isLoading || (!isCurrentData && !error)
  const totals = isCurrentData ? data.totals : null
  const sections = isCurrentData ? data.sections : []
  const partialEntities = isCurrentData ? (data.partialEntities ?? []) : []
  const netClass = totals == null
    ? ''
    : (totals.netIncome >= 0 ? 'green' : 'red')

  // Drill-down captures the page's entity at click time so changing the entity
  // tab while a drawer is open doesn't yank its data out from under the user.
  // To switch the drawer to a different scope, close and reopen.
  function openDrill(glCode: string, label: string) {
    setDrill({
      entity,
      accountNumber: glCode,
      accountLabel: label,
      periodStart: period.start,
      periodEnd: period.end,
    })
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">P&amp;L</div>
        <div className="page-sub">Profit &amp; loss reports from QuickBooks</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITY_TABS.map((e) => (
            <button
              key={e}
              className={`entity-tab${entity === e ? ' active' : ''}`}
              onClick={() => setEntity(e)}
              style={entity === e && e !== 'All' ? { color: ENTITY_COLORS[e] } : undefined}
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

      {entity === 'All' && partialEntities.length > 0 && !loading && (
        <div style={{
          padding: '10px 14px', margin: '0 0 12px',
          background: 'rgba(255,200,0,0.1)', border: '1px solid rgba(255,200,0,0.4)',
          borderRadius: 'var(--radius)', fontSize: '0.8rem',
        }}>
          Showing {ENTITIES.length - partialEntities.length} of {ENTITIES.length} entities — {partialEntities.join(', ')} data unavailable for this period.
        </div>
      )}

      {loading ? (
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

      {loading ? (
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
            {entity === 'All'
              ? 'Connect at least one entity via Budget → Settings → QuickBooks, then retry.'
              : `Connect ${entity} via the Budget → Settings → QuickBooks panel, then retry.`}
          </div>
        </div>
      ) : sections.length === 0 ? (
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
              {sections.map((section, i) => (
                <PnlRow key={i} node={section} depth={0} onGlClick={openDrill} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GlDrillDrawer
        open={drill !== null}
        onClose={() => setDrill(null)}
        entity={drill?.entity ?? 'Opco'}
        accountNumber={drill?.accountNumber ?? ''}
        accountLabel={drill?.accountLabel ?? ''}
        periodStart={drill?.periodStart ?? ''}
        periodEnd={drill?.periodEnd ?? ''}
      />
    </div>
  )
}
