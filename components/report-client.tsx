'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { fmtUSD } from '@/lib/format'
import { ENTITIES } from '@/lib/constants'
import { PNL_GROUPS, type PnlGroup, type PnlKind } from '@/lib/report/pnl-inventory'
import { accountInTrendMetric, trendAccountContribution, trendMetricAmount, trendMetricLabel, type TrendMetric } from '@/lib/report/trend-metrics'
import { getFinancialMonth, getYtdSummary, type FinancialMonth, type PresentationFinancials } from '@/lib/presentation/financials'
import type { QboEntity } from '@/lib/qb/config'
import { GlDrillModal } from '@/components/gl-drill-modal'
import { PnlPageClient } from '@/components/pnl-page-client'
import BalanceSheetPageClient from '@/components/balance-sheet-page-client'

type Entity = QboEntity | 'All'
type View = 'mom' | 'ytd' | 'balanceSheet' | 'pnl' | 'slides'
type Metric = TrendMetric
type GroupKey = `${PnlKind}|${PnlGroup}`
type SlideId = 'cover' | 'mom' | 'revenue' | 'net' | 'ytd' | 'revenue-mix' | 'operating' | 'compensation' | 'technology' | 'professional' | 'other-costs' | 'below-line' | 'bridge'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ENTITY_COLORS: Record<QboEntity, string> = { Opco: '#3dbdae', Foundation: '#85a7f7', Juku: '#e9a156', Zagreus: '#b595e9' }
const KINDS: PnlKind[] = ['income', 'other-income', 'expense', 'other-expense', 'other']
const KIND_NAMES: Record<PnlKind, string> = { income: 'Income', 'other-income': 'Other income', expense: 'Expenses', 'other-expense': 'Other expenses', other: 'Other QB sections' }
const OPERATING: PnlGroup[] = ['professional', 'people-operations', 'travel', 'offsite', 'marketing', 'transaction-fees', 'office', 'other-operating', 'unclassified']
const COMPENSATION: PnlGroup[] = ['employee-cash', 'employee-token', 'contractor-cash', 'contractor-token', 'benefits-severance']
const TECHNOLOGY: PnlGroup[] = ['software', 'infrastructure', 'tech-audits']
const BELOW_LINE: PnlGroup[] = ['intercompany', 'asset-gains', 'treasury-income', 'other-income', 'financing', 'other-nonoperating', 'depreciation', 'taxes', 'reconciliation']
const SLIDES: Array<{ id: SlideId; title: string }> = [
  { id: 'cover', title: 'Financial review' },
  { id: 'mom', title: 'MoM comparison' },
  { id: 'revenue', title: 'Revenue trend' },
  { id: 'net', title: 'Net income trend' },
  { id: 'ytd', title: 'YTD comparison' },
  { id: 'revenue-mix', title: 'Revenue composition' },
  { id: 'operating', title: 'Operating expenses' },
  { id: 'compensation', title: 'Compensation expenses' },
  { id: 'technology', title: 'Tech fees' },
  { id: 'professional', title: 'Professional services' },
  { id: 'other-costs', title: 'Other operating costs' },
  { id: 'below-line', title: 'Other P&L items' },
  { id: 'bridge', title: 'Reported P&L bridge' },
]

const money = (value: number | null | undefined) => value == null ? '—' : fmtUSD(value)
const chartMoney = (value: number) => fmtUSD(value, 0)
const exact = (value: number | null | undefined) => value == null ? '—' : fmtUSD(value)
const totalRevenue = (row: FinancialMonth | null) => row ? row.totals.revenue + row.totals.otherIncome : null
const totalExpense = (row: FinancialMonth | null) => row ? row.totals.expense + row.totals.otherExpense : null
const groupAmount = (row: FinancialMonth | null, key: GroupKey) => row?.inventory.groups.find((item) => `${item.kind}|${item.group}` === key)?.amount ?? 0
const scopeName = (entity: Entity) => entity === 'All' ? 'Reported group' : entity
const coverage = (row: FinancialMonth | null) => row ? `${row.presentEntities.length}/4 entities` : 'No QB cache'
const valid = (row: FinancialMonth | null) => !!row && row.inventory.sectionResiduals.length === 0 && Math.abs(row.inventory.netIncomeResidual) < 0.005 && row.inventory.unclassified.length === 0

const metricAmount = trendMetricAmount
const metricLabel = trendMetricLabel
const accountInMetric = accountInTrendMetric

function groupKeys(rows: Array<FinancialMonth | null>): GroupKey[] {
  const keys = new Set<GroupKey>()
  for (const row of rows) for (const item of row?.inventory.groups ?? []) keys.add(`${item.kind}|${item.group}`)
  return [...keys].sort((a, b) => {
    const [kindA, groupA] = a.split('|') as [PnlKind, PnlGroup]
    const [kindB, groupB] = b.split('|') as [PnlKind, PnlGroup]
    return KINDS.indexOf(kindA) - KINDS.indexOf(kindB) || Object.keys(PNL_GROUPS).indexOf(groupA) - Object.keys(PNL_GROUPS).indexOf(groupB)
  })
}

function Coverage({ data, year, month, entity = 'All' }: { data: PresentationFinancials; year: number; month: number; entity?: Entity }) {
  const row = getFinancialMonth(data, entity, month)
  if (row && entity !== 'All' && valid(row)) return null
  const missing = ENTITIES.filter((name) => !row?.presentEntities.includes(name))
  const reconciliation = row && !valid(row) ? ` Review: ${row.inventory.unclassified.length} unclassified account(s), ${row.inventory.sectionResiduals.length} section difference(s).` : ''
  return <div className="report-warning" role="status">{MONTHS[month - 1]} {year}: {row ? `reported ${row.presentEntities.join(', ')}` : 'no cached P&L'}{entity === 'All' && missing.length ? `; missing ${missing.join(', ')}` : ''}. Figures include available companies only.{reconciliation}</div>
}

type ReportDetail = { entity: Entity; month: number; metric: Metric; compareMonth?: number; rangeStart?: number }
type OpenDetail = (detail: ReportDetail) => void

function AmountButton({ value, label, onClick }: { value: number | null | undefined; label: string; onClick: () => void }) {
  return value == null ? <>—</> : <button className="report-value-button" onClick={onClick} aria-label={`${label}: ${money(value)}. View QuickBooks accounts and entries`}>{money(value)}</button>
}

function Stat({ label, value, detail, onClick, onDetailClick }: { label: string; value: number | null; detail?: string; onClick?: () => void; onDetailClick?: () => void }) {
  return <div className="report-stat"><span>{label}</span><strong>{onClick ? <AmountButton value={value} label={label} onClick={onClick} /> : money(value)}</strong>{detail && <small>{onDetailClick ? <button className="report-row-button" onClick={onDetailClick}>{detail}</button> : detail}</small>}</div>
}

function EntityComparison({ data, year, monthA, monthB, onOpen }: { data: PresentationFinancials; year: number; monthA: number; monthB: number; onOpen?: OpenDetail }) {
  return <div className="report-entity-grid">{ENTITIES.map((entity) => {
    const a = getFinancialMonth(data, entity, monthA), b = getFinancialMonth(data, entity, monthB)
    const current = b?.totals.netIncome, previous = a?.totals.netIncome
    return <article className="report-entity" key={entity} style={{ borderTopColor: ENTITY_COLORS[entity] }}>
      <header><strong>{entity}</strong><span>{b ? 'QB P&L' : 'Missing cache'}</span></header>
      <dl><div><dt>Revenue</dt><dd>{onOpen ? <AmountButton value={totalRevenue(b)} label={`${entity} revenue · ${MONTHS[monthB - 1]}`} onClick={() => onOpen({ entity, month: monthB, metric: 'revenue' })} /> : money(totalRevenue(b))}</dd></div><div><dt>Expenses</dt><dd>{onOpen ? <AmountButton value={totalExpense(b)} label={`${entity} expenses · ${MONTHS[monthB - 1]}`} onClick={() => onOpen({ entity, month: monthB, metric: 'expense' })} /> : money(totalExpense(b))}</dd></div><div className="report-emphasis"><dt>Net income</dt><dd>{onOpen ? <AmountButton value={current} label={`${entity} net income · ${MONTHS[monthB - 1]}`} onClick={() => onOpen({ entity, month: monthB, metric: 'netIncome' })} /> : money(current)}</dd></div></dl>
      <footer>{a && b ? <>Net vs {MONTHS[monthA - 1]}: {onOpen ? <AmountButton value={current! - previous!} label={`${entity} net MoM`} onClick={() => onOpen({ entity, month: monthB, metric: 'netIncome', compareMonth: monthA })} /> : money(current! - previous!)}</> : `MoM unavailable · ${MONTHS[monthA - 1]} to ${MONTHS[monthB - 1]} ${year}`}</footer>
    </article>
  })}</div>
}

function SubgroupMatrix({ data, monthA, monthB, onOpen }: { data: PresentationFinancials; monthA: number; monthB: number; onOpen: OpenDetail }) {
  const a = getFinancialMonth(data, 'All', monthA), b = getFinancialMonth(data, 'All', monthB)
  // Keep historically active P&L subgroups visible even when both selected
  // months have a zero balance (for example 641xx Company offsite in Aug/Sep).
  const keys = groupKeys(data.months.filter((row) => row.entity === 'All' && row.month <= Math.max(monthA, monthB)))
  return <div className="report-table-scroll"><table className="report-table"><thead><tr><th>QB section / subgroup</th>{ENTITIES.map((entity) => <th key={entity}>{entity}</th>)}<th>Reported total</th><th>MoM change</th></tr></thead><tbody>
      {keys.map((key, index) => {
        const [kind, group] = key.split('|') as [PnlKind, PnlGroup]
        const prev = keys[index - 1]?.split('|')[0]
        const amount = b ? groupAmount(b, key) : null
        const change = a && b && a.presentEntities.join(',') === b.presentEntities.join(',') ? groupAmount(b, key) - groupAmount(a, key) : null
        return <tr key={key}>
          <td>{kind !== prev && <span className="report-kind">{KIND_NAMES[kind]}</span>}{PNL_GROUPS[group]}</td>
          {ENTITIES.map((entity) => <td key={entity}><AmountButton value={getFinancialMonth(data, entity, monthB) ? groupAmount(getFinancialMonth(data, entity, monthB), key) : null} label={`${entity} ${PNL_GROUPS[group]} · ${MONTHS[monthB - 1]}`} onClick={() => onOpen({ entity, month: monthB, metric: `group:${key}` })} /></td>)}
          <td className="report-strong"><AmountButton value={amount} label={`Reported ${PNL_GROUPS[group]} · ${MONTHS[monthB - 1]}`} onClick={() => onOpen({ entity: 'All', month: monthB, metric: `group:${key}` })} /></td><td><AmountButton value={change} label={`${PNL_GROUPS[group]} MoM change`} onClick={() => onOpen({ entity: 'All', month: monthB, metric: `group:${key}`, compareMonth: monthA })} /></td>
        </tr>
      })}
      {!keys.length && <tr><td colSpan={7}>No cached P&L for the selected months.</td></tr>}
    </tbody></table></div>
}

function Trend({ data, entity, month, metric, compact = false }: { data: PresentationFinancials; entity: Entity; month: number; metric: Metric; compact?: boolean }) {
  const scopes: Entity[] = entity === 'All' ? ['All', ...ENTITIES] : [entity]
  const series = scopes.map((scope) => ({ scope, values: Array.from({ length: month }, (_, index) => metricAmount(getFinancialMonth(data, scope, index + 1), metric)) }))
  const values = series.flatMap((item) => item.values).filter((value): value is number => value !== null)
  if (!values.length) return <div className="report-empty">No P&amp;L values for this trend.</div>
  const width = 940, height = compact ? 260 : 360, left = 90, right = 28, top = 24, bottom = 46
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values), span = hi - lo || 1
  const x = (index: number) => left + index * (width - left - right) / Math.max(month - 1, 1)
  const y = (value: number) => top + (hi - value) / span * (height - top - bottom)
  const ticks = [0, 1, 2, 3, 4].map((index) => lo + index * span / 4)
  function curve(points: Array<{ x: number; y: number }>) {
    if (!points.length) return ''
    return `M ${points[0].x} ${points[0].y}` + points.slice(1).map((point, index) => {
      const prev = points[index], before = points[index - 1] ?? prev, after = points[index + 2] ?? point
      const dx = (point.x - prev.x) / 6
      return ` C ${prev.x + dx} ${prev.y + (point.y - before.y) / 6}, ${point.x - dx} ${point.y - (after.y - prev.y) / 6}, ${point.x} ${point.y}`
    }).join('')
  }
  const zeroY = y(0)
  return <div className="report-chart-wrap"><svg className="report-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Monthly ${metricLabel(metric)} by entity through ${MONTHS[month - 1]} ${data.year}`}>
    {ticks.map((value, index) => <g key={index}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#b7c3d0" strokeOpacity=".23" /><text x={left - 12} y={y(value) + 4} textAnchor="end" fill="#68798d" fontSize="12">{chartMoney(value)}</text></g>)}
    {Array.from({ length: month }, (_, index) => <text key={index} x={x(index)} y={height - 12} textAnchor="middle" fill="#68798d" fontSize="12">{MONTHS[index]}</text>)}
    {series.map(({ scope, values: points }) => {
      const color = scope === 'All' ? '#c79a30' : ENTITY_COLORS[scope]
      const segments: Array<Array<{ x: number; y: number }>> = []
      points.forEach((value, index) => { if (value == null) return; if (index === 0 || points[index - 1] == null) segments.push([]); segments.at(-1)!.push({ x: x(index), y: y(value) }) })
      return <g key={scope}>{segments.map((segment, index) => segment.length < 2 ? null : <path key={index} d={`${curve(segment)} L ${segment.at(-1)!.x} ${zeroY} L ${segment[0].x} ${zeroY} Z`} fill={color} fillOpacity={scope === 'All' ? 0.025 : 0.065} stroke="none" />)}
        {segments.map((segment, index) => <path key={`line-${index}`} d={curve(segment)} fill="none" stroke={color} strokeWidth={scope === 'All' ? 2.6 : 2} strokeLinejoin="round" />)}
        {points.map((value, index) => value == null ? null : <circle key={index} cx={x(index)} cy={y(value)} r={scope === 'All' ? 3.8 : 3.5} fill="var(--surface)" stroke={color} strokeWidth="2"><title>{scopeName(scope)} · {MONTHS[index]}: {exact(value)}</title></circle>)}
      </g>
    })}
  </svg><div className="report-legend">{series.map(({ scope }) => <span key={scope}><i style={{ background: scope === 'All' ? '#c79a30' : ENTITY_COLORS[scope] }} />{scopeName(scope)}</span>)}</div></div>
}

function YtdTrend({ data, entity, month, metric, onOpen }: { data: PresentationFinancials; entity: Entity; month: number; metric: Metric; onOpen: OpenDetail }) {
  const scopes: Entity[] = entity === 'All' ? ['All', ...ENTITIES] : [entity]
  const rows = Array.from({ length: month }, (_, index) => ({ month: index + 1, row: getFinancialMonth(data, entity, index + 1) }))
  const amounts = rows.map(({ row }) => metricAmount(row, metric))
  const total = amounts.some((value) => value != null) ? amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null
  const latest = amounts.at(-1) ?? null, previous = amounts.at(-2) ?? null
  return <>
    <Trend data={data} entity={entity} month={month} metric={metric} />
    <div className="report-stats report-trend-stats"><Stat label={`YTD ${metricLabel(metric)}`} value={total} onClick={() => onOpen({ entity, month, metric, rangeStart: 1 })} /><Stat label="Latest month" value={latest} onClick={() => onOpen({ entity, month, metric })} /><Stat label="Previous month" value={previous} onClick={() => onOpen({ entity, month: month - 1, metric })} /><Stat label="MoM change" value={latest != null && previous != null ? latest - previous : null} onClick={() => onOpen({ entity, month, metric, compareMonth: month - 1 })} /></div>
    <div className="report-table-scroll"><table className="report-table"><thead><tr><th>Month</th>{scopes.map((scope) => <th key={scope}><span className="report-entity-key" style={{ background: scope === 'All' ? '#c79a30' : ENTITY_COLORS[scope] }} />{scopeName(scope)}</th>)}</tr></thead><tbody>{rows.map(({ month: selectedMonth }) => <tr key={selectedMonth}><td>{MONTHS[selectedMonth - 1]}</td>{scopes.map((scope) => { const value = metricAmount(getFinancialMonth(data, scope, selectedMonth), metric); return <td key={scope}><AmountButton value={value} label={`${scopeName(scope)} · ${metricLabel(metric)} · ${MONTHS[selectedMonth - 1]} ${data.year}`} onClick={() => onOpen({ entity: scope, month: selectedMonth, metric })} /></td> })}</tr>)}</tbody></table></div>
    <p className="report-footnote">Click a value for the QuickBooks account breakdown, then an account for its journal entries. A dash means that entity has no cached P&amp;L for that month. Reported group includes available entities only.</p>
  </>
}

function ReportValueDrill({ data, detail, onClose }: { data: PresentationFinancials; detail: ReportDetail; onClose: () => void }) {
  const [activeMonth, setActiveMonth] = useState(detail.month)
  const [gl, setGl] = useState<{ entity: Entity; code: string; label: string } | null>(null)
  const firstMonth = detail.rangeStart ?? activeMonth
  const months = Array.from({ length: activeMonth - firstMonth + 1 }, (_, index) => firstMonth + index)
  const scopes: Entity[] = detail.entity === 'All' ? [...ENTITIES] : [detail.entity]
  const shown = months.flatMap((selectedMonth) => scopes.flatMap((scope) => (getFinancialMonth(data, scope, selectedMonth)?.inventory.accounts ?? [])
    .filter((account) => accountInMetric(account.kind, account.group, detail.metric) && account.amount !== 0)
    .map((account) => ({ scope, account }))))
  const grouped = new Map<string, { scope: Entity; code: string | null; label: string; kind: PnlKind; amount: number }>()
  for (const { scope, account } of shown) {
    const key = `${scope}|${account.kind}|${account.glCode ?? account.label}`
    const entry = grouped.get(key)
    if (entry) entry.amount = (Math.round(entry.amount * 100) + Math.round(account.amount * 100)) / 100
    else grouped.set(key, { scope, code: account.glCode, label: account.label, kind: account.kind, amount: account.amount })
  }
  const selectedAmounts = months.map((selectedMonth) => metricAmount(getFinancialMonth(data, detail.entity, selectedMonth), detail.metric))
  const selectedTotal = selectedAmounts.some((value) => value != null) ? selectedAmounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null
  const accountTotal = [...grouped.values()].reduce((sum, entry) => sum + trendAccountContribution(entry.amount, entry.kind, detail.metric), 0)
  const residual = selectedTotal == null ? 0 : Math.round((selectedTotal - accountTotal) * 100) / 100
  const currentTotal = metricAmount(getFinancialMonth(data, detail.entity, detail.month), detail.metric)
  const priorTotal = detail.compareMonth ? metricAmount(getFinancialMonth(data, detail.entity, detail.compareMonth), detail.metric) : null
  const periodStart = `${data.year}-${String(firstMonth).padStart(2, '0')}-01`
  const periodEnd = `${data.year}-${String(activeMonth).padStart(2, '0')}-${new Date(Date.UTC(data.year, activeMonth, 0)).getUTCDate()}`
  useEffect(() => {
    if (gl) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !(event.target instanceof HTMLSelectElement)) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [gl, onClose])
  return <>
    {!gl && <div className="modal-overlay open" onClick={onClose}><div className="modal report-trend-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${metricLabel(detail.metric)} breakdown`}><div className="modal-header"><div><div className="modal-title">{metricLabel(detail.metric)} · {scopeName(detail.entity)} · {detail.rangeStart ? `${MONTHS[detail.rangeStart - 1]}–` : ''}{MONTHS[detail.month - 1]} {data.year}</div><div className="modal-sub">QuickBooks reported P&amp;L · {getFinancialMonth(data, detail.entity, activeMonth)?.presentEntities.join(', ') || 'No cached entities'}</div></div><button className="modal-close" aria-label="Close breakdown" onClick={onClose}>×</button></div><div className="modal-body">
      {detail.compareMonth && <div className="report-compare-values"><span>MoM change: <strong>{money(currentTotal != null && priorTotal != null ? currentTotal - priorTotal : null)}</strong></span><button className={activeMonth === detail.compareMonth ? 'active' : ''} onClick={() => setActiveMonth(detail.compareMonth!)}>{MONTHS[detail.compareMonth - 1]}: {money(priorTotal)}</button><button className={activeMonth === detail.month ? 'active' : ''} onClick={() => setActiveMonth(detail.month)}>{MONTHS[detail.month - 1]}: {money(currentTotal)}</button></div>}
      <div className="report-detail-total">{detail.rangeStart ? 'YTD reported value' : 'Reported value'} <strong>{money(selectedTotal)}</strong></div><div className="report-table-scroll"><table className="report-table"><thead><tr><th>Entity / QB account</th><th>Section</th><th>{detail.metric === 'netIncome' ? 'Net impact' : 'Amount'}</th></tr></thead><tbody>{[...grouped.values()].map((entry, index) => <tr key={`${entry.scope}-${entry.kind}-${entry.code}-${index}`}><td><span className="report-detail-entity">{entry.scope}</span>{entry.code ? <button className="report-row-button" onClick={() => setGl({ entity: entry.scope, code: entry.code!, label: entry.label })}>{entry.code} · {entry.label}</button> : `${entry.label} (no QB code)`}</td><td>{KIND_NAMES[entry.kind]}</td><td>{money(trendAccountContribution(entry.amount, entry.kind, detail.metric))}</td></tr>)}{Math.abs(residual) >= 0.005 && <tr><td>QB report subtotal difference</td><td>Reconciliation</td><td>{money(residual)}</td></tr>}{grouped.size === 0 && <tr><td colSpan={3}>No account lines for this value.</td></tr>}</tbody></table></div>{detail.metric === 'netIncome' && <p className="report-footnote">Net impact by account: income and other income add; expenses and other expenses subtract. Click an account to see its original QuickBooks ledger entries.</p>}</div></div></div>}
    <GlDrillModal open={gl !== null} onClose={() => setGl(null)} entity={gl?.entity ?? 'Opco'} accountNumber={gl?.code ?? ''} accountLabel={gl?.label ?? ''} periodStart={periodStart} periodEnd={periodEnd} />
  </>
}

function YtdCompare({ current, prior, year, month, compact = false }: { current: PresentationFinancials; prior?: PresentationFinancials; year: number; month: number; compact?: boolean }) {
  return <div className="report-table-scroll"><table className="report-table"><thead><tr><th>Entity</th><th>{year - 1} YTD revenue</th><th>{year} YTD revenue</th><th>Revenue change</th><th>{year - 1} YTD net</th><th>{year} YTD net</th><th>Net change</th></tr></thead><tbody>
    {([...ENTITIES, 'All'] as Entity[]).map((entity) => {
      const a = getYtdSummary(prior, entity, month), b = getYtdSummary(current, entity, month)
      const revA = a.months ? a.totals.revenue + a.totals.otherIncome : null
      const revB = b.months ? b.totals.revenue + b.totals.otherIncome : null
      const comparable = a.complete && b.complete
      return <tr key={entity}><td><strong>{scopeName(entity)}</strong><small className="report-cell-note">{a.months}/{month} vs {b.months}/{month} months{entity === 'All' ? ' · partial if any entity is missing' : ''}</small></td><td>{money(revA)}</td><td>{money(revB)}</td><td>{comparable ? money(revB! - revA!) : '—'}</td><td>{money(a.months ? a.totals.netIncome : null)}</td><td>{money(b.months ? b.totals.netIncome : null)}</td><td>{comparable ? money(b.totals.netIncome - a.totals.netIncome) : '—'}</td></tr>
    })}
  </tbody></table>{!compact && <p className="report-footnote">YTD compares January through {MONTHS[month - 1]} in both years. Changes appear only when every month and entity in that row is available.</p>}</div>
}

function CategorySlide({ data, month, groups, title, sectionKinds, netEffect = false }: { data: PresentationFinancials; month: number; groups: readonly PnlGroup[]; title: string; sectionKinds?: readonly PnlKind[]; netEffect?: boolean }) {
  const all = getFinancialMonth(data, 'All', month)
  const keys = groupKeys([all]).filter((key) => {
    const [kind, group] = key.split('|') as [PnlKind, PnlGroup]
    return groups.includes(group) && (!sectionKinds || sectionKinds.includes(kind))
  })
  const total = keys.reduce((sum, key) => {
    const kind = key.split('|')[0] as PnlKind
    return sum + groupAmount(all, key) * (netEffect && (kind === 'expense' || kind === 'other-expense') ? -1 : 1)
  }, 0)
  return <><div className="report-slide-lead"><span>{netEffect ? 'Net income contribution' : title}</span><strong>{all ? money(total) : '—'}</strong><small>{netEffect ? 'Signed effect; QB balances below' : 'Reported balance'} · {MONTHS[month - 1]} {data.year}</small></div><div className="report-table-scroll"><table className="report-table"><thead><tr><th>QB section / subgroup</th>{ENTITIES.map((entity) => <th key={entity}>{entity}</th>)}<th>Reported total</th></tr></thead><tbody>
    {keys.map((key) => { const [kind, group] = key.split('|') as [PnlKind, PnlGroup]; return <tr key={key}><td><span className="report-kind-inline">{KIND_NAMES[kind]}</span>{PNL_GROUPS[group]}</td>{ENTITIES.map((entity) => { const row = getFinancialMonth(data, entity, month); return <td key={entity}>{row ? money(groupAmount(row, key)) : '—'}</td> })}<td className="report-strong">{money(groupAmount(all, key))}</td></tr> })}
    {!keys.length && <tr><td colSpan={6}>No values in this category for the selected month.</td></tr>}
  </tbody></table></div></>
}

function BridgeSlide({ data, month }: { data: PresentationFinancials; month: number }) {
  const all = getFinancialMonth(data, 'All', month)
  const sections: Array<[string, (row: FinancialMonth) => number]> = [
    ['Income', (row) => row.totals.revenue], ['Other income', (row) => row.totals.otherIncome],
    ['Total revenue', (row) => row.totals.revenue + row.totals.otherIncome],
    ['Expenses', (row) => row.totals.expense], ['Other expenses', (row) => row.totals.otherExpense],
    ['Total expenses', (row) => row.totals.expense + row.totals.otherExpense],
    ['Net income', (row) => row.totals.netIncome],
  ]
  return <><div className="report-slide-lead"><span>QuickBooks reported net income</span><strong>{money(all?.totals.netIncome)}</strong><small>Signed balance · no intercompany eliminations</small></div><div className="report-table-scroll"><table className="report-table"><thead><tr><th>P&amp;L section</th>{ENTITIES.map((entity) => <th key={entity}>{entity}</th>)}<th>Reported total</th></tr></thead><tbody>{sections.map(([label, value]) => <tr key={label}><td>{label}</td>{ENTITIES.map((entity) => { const row = getFinancialMonth(data, entity, month); return <td key={entity}>{money(row ? value(row) : null)}</td> })}<td className="report-strong">{money(all ? value(all) : null)}</td></tr>)}</tbody></table></div><p className="report-footnote">Net income = Income + Other income − Expenses − Other expenses. Intercompany charges remain included in the reported group.</p></>
}

function SlideContent({ id, data, prior, monthA, monthB, year }: { id: SlideId; data: PresentationFinancials; prior?: PresentationFinancials; monthA: number; monthB: number; year: number }) {
  if (id === 'cover') return <div className="report-cover"><span>ORCA · FINANCIAL REPORT</span><h2>Financial<br />review</h2><p>Opco · Foundation · Juku · Zagreus</p><small>{MONTHS[monthB - 1]} {year} · QuickBooks reported P&amp;L</small></div>
  if (id === 'mom') return <><EntityComparison data={data} year={year} monthA={monthA} monthB={monthB} /><div className="report-slide-note">Current month {MONTHS[monthB - 1]} versus {MONTHS[monthA - 1]}. Missing entities are shown as gaps.</div></>
  if (id === 'revenue' || id === 'net') return <><div className="report-slide-lead"><span>{id === 'revenue' ? 'Monthly revenue' : 'Monthly net income'}</span><strong>{money(metricAmount(getFinancialMonth(data, 'All', monthB), id === 'revenue' ? 'revenue' : 'netIncome'))}</strong><small>Latest reported month · {MONTHS[monthB - 1]} {year}</small></div><Trend data={data} entity="All" month={monthB} metric={id === 'revenue' ? 'revenue' : 'netIncome'} compact /></>
  if (id === 'ytd') return <YtdCompare current={data} prior={prior} year={year} month={monthB} compact />
  if (id === 'revenue-mix') return <CategorySlide data={data} month={monthB} groups={['protocol-revenue', 'managed-services', 'treasury-income', 'asset-gains', 'other-income', 'unclassified']} sectionKinds={['income', 'other-income']} title="Income and asset movements" />
  if (id === 'operating') return <CategorySlide data={data} month={monthB} groups={[...COMPENSATION, ...TECHNOLOGY, ...OPERATING]} sectionKinds={['expense']} title="Operating expenses" />
  if (id === 'compensation') return <CategorySlide data={data} month={monthB} groups={COMPENSATION} title="Cash, token and benefits" />
  if (id === 'technology') return <CategorySlide data={data} month={monthB} groups={TECHNOLOGY} title="Software, infrastructure and audits" />
  if (id === 'professional') return <CategorySlide data={data} month={monthB} groups={['professional', 'people-operations']} title="Professional services and people operations" />
  if (id === 'other-costs') return <CategorySlide data={data} month={monthB} groups={['travel', 'offsite', 'marketing', 'transaction-fees', 'office', 'other-operating']} title="Travel, marketing, fees and office" />
  if (id === 'below-line') return <CategorySlide data={data} month={monthB} groups={BELOW_LINE} title="Treasury, intercompany and other items" netEffect />
  return <BridgeSlide data={data} month={monthB} />
}

function Slide({ slide, data, prior, monthA, monthB, year, note, onNote, editable }: { slide: typeof SLIDES[number]; data: PresentationFinancials; prior?: PresentationFinancials; monthA: number; monthB: number; year: number; note: string; onNote?: (note: string) => void; editable: boolean }) {
  return <article className={`report-slide ${slide.id === 'cover' ? 'is-cover' : ''}`}>
    {slide.id !== 'cover' && <header className="report-slide-header"><span>ORCA · FINANCIAL REPORT</span><h2>{slide.title}</h2><small>{slide.id === 'ytd' ? `Jan–${MONTHS[monthB - 1]} ${year} vs ${year - 1}` : `${MONTHS[monthB - 1]} ${year}`} · Reported P&amp;L</small></header>}
    <div className="report-slide-body"><SlideContent id={slide.id} data={data} prior={prior} monthA={monthA} monthB={monthB} year={year} /></div>
    {slide.id !== 'cover' && <footer className="report-slide-footer"><span>{getFinancialMonth(data, 'All', monthB)?.presentEntities.join(' · ') || 'No QB cache'} · {coverage(getFinancialMonth(data, 'All', monthB))}</span><span>Amounts in USD · no eliminations</span></footer>}
    {editable && slide.id !== 'cover' && <div className="report-speaker"><label htmlFor="report-slide-note">Speaker notes</label><textarea id="report-slide-note" value={note} onChange={(event) => onNote?.(event.target.value)} placeholder="Add your commentary for this slide…" /></div>}
  </article>
}

export function ReportClient({ initialYear, years }: { initialYear: number; years: number[] }) {
  const [year, setYear] = useState(initialYear)
  const [view, setView] = useState<View>('mom')
  const [entity, setEntity] = useState<Entity>('All')
  const [monthA, setMonthA] = useState(1)
  const [monthB, setMonthB] = useState(8)
  const [metric, setMetric] = useState<Metric>('netIncome')
  const [detail, setDetail] = useState<ReportDetail | null>(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const { data, error, isLoading } = useSWR<PresentationFinancials>(view === 'balanceSheet' || view === 'pnl' ? null : `/api/report/financials?year=${year}`, apiFetch)
  const { data: prior, error: priorError } = useSWR<PresentationFinancials>(view === 'slides' ? `/api/report/financials?year=${year - 1}` : null, apiFetch)
  const available = useMemo(() => [...new Set((data?.months ?? []).filter((row) => row.entity === 'All').map((row) => row.month))].sort((a, b) => a - b), [data])

  useEffect(() => {
    if (!available.length) return
    setMonthB(available.at(-1)!)
    setMonthA(available.at(-2) ?? available.at(-1)!)
  }, [available])
  useEffect(() => {
    try { setNotes(JSON.parse(localStorage.getItem(`tidelog-report-notes-${year}`) || '{}')) } catch { setNotes({}) }
  }, [year])
  useEffect(() => {
    if (view !== 'slides') return
    const listener = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return
      if (event.key === 'ArrowRight') setSlideIndex((index) => Math.min(index + 1, SLIDES.length - 1))
      if (event.key === 'ArrowLeft') setSlideIndex((index) => Math.max(index - 1, 0))
      if (event.key === 'Escape') setView('mom')
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [view])

  function saveNote(value: string) {
    const next = { ...notes, [`${slideIndex}`]: value }
    setNotes(next)
    localStorage.setItem(`tidelog-report-notes-${year}`, JSON.stringify(next))
  }
  const current = data ? getFinancialMonth(data, entity, monthB) : null
  const earlier = data ? getFinancialMonth(data, entity, monthA) : null
  const comparable = !!current && !!earlier && (entity !== 'All' || current.presentEntities.join(',') === earlier.presentEntities.join(','))
  const choices = useMemo(() => data ? groupKeys(data.months.filter((row) => row.entity === entity && row.month <= monthB)) : [], [data, entity, monthB])

  useEffect(() => {
    if (metric.startsWith('group:') && !choices.includes(metric.slice(6) as GroupKey)) setMetric('netIncome')
  }, [choices, metric])

  return <main className="report-page">
    <div className="page-header"><div><div className="page-title">Report</div><div className="page-sub">QuickBooks P&amp;L · management categories · C-level presentation</div></div></div>
    <div className="report-toolbar"><div className="report-tabs" role="tablist" aria-label="Report views">{([['mom', 'MoM Comparison'], ['ytd', 'YTD Trend'], ['balanceSheet', 'Balance Sheet'], ['pnl', 'P&L'], ['slides', 'Presentation']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</div>
      {view !== 'balanceSheet' && view !== 'pnl' && <><label>Year <select value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item}>{item}</option>)}</select></label>
      {view !== 'slides' && <label>Entity <select value={entity} onChange={(event) => setEntity(event.target.value as Entity)}><option value="All">Reported group</option>{ENTITIES.map((name) => <option key={name}>{name}</option>)}</select></label>}
      {view === 'mom' && <label>Compare <select value={monthA} onChange={(event) => setMonthA(Number(event.target.value))}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>}
      <label>{view === 'ytd' ? 'Through' : 'Month'} <select value={monthB} onChange={(event) => setMonthB(Number(event.target.value))}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label></>}
    </div>
    {view === 'balanceSheet' && <BalanceSheetPageClient embedded />}
    {view === 'pnl' && <PnlPageClient initialEntity={entity} initialMode="ytd" initialYear={year} initialMonth={monthB} initialData={null} availableYears={years} embedded />}
    {isLoading && !data && <div className="report-empty">Loading cached QuickBooks P&amp;Ls…</div>}
    {error && <div className="report-warning" role="alert">Could not load P&amp;L data: {error instanceof Error ? error.message : String(error)}</div>}
    {data && <>
      {view === 'mom' && <section className="report-panel"><div className="report-section-head"><div><span>MONTHLY COMPARISON</span><h2>{MONTHS[monthA - 1]} vs {MONTHS[monthB - 1]} {year}</h2></div><p>QB values as reported · signed credits and losses</p></div><Coverage data={data} year={year} month={monthB} />
        <EntityComparison data={data} year={year} monthA={monthA} monthB={monthB} onOpen={setDetail} />
        <div className="report-stats"><Stat label="Revenue" value={totalRevenue(current)} onClick={() => setDetail({ entity, month: monthB, metric: 'revenue' })} detail={comparable ? `MoM ${money(totalRevenue(current)! - totalRevenue(earlier)!)}` : 'Comparison unavailable'} onDetailClick={comparable ? () => setDetail({ entity, month: monthB, metric: 'revenue', compareMonth: monthA }) : undefined} /><Stat label="Expenses" value={totalExpense(current)} onClick={() => setDetail({ entity, month: monthB, metric: 'expense' })} detail={comparable ? `MoM ${money(totalExpense(current)! - totalExpense(earlier)!)}` : 'Comparison unavailable'} onDetailClick={comparable ? () => setDetail({ entity, month: monthB, metric: 'expense', compareMonth: monthA }) : undefined} /><Stat label="Net income" value={current?.totals.netIncome ?? null} onClick={() => setDetail({ entity, month: monthB, metric: 'netIncome' })} detail={comparable ? `MoM ${money(current!.totals.netIncome - earlier!.totals.netIncome)}` : 'Comparison unavailable'} onDetailClick={comparable ? () => setDetail({ entity, month: monthB, metric: 'netIncome', compareMonth: monthA }) : undefined} /><Stat label="Reconciliation residual" value={current ? Math.abs(current.inventory.netIncomeResidual) + current.inventory.sectionResiduals.reduce((sum, item) => sum + Math.abs(item.amount), 0) : null} detail={current?.inventory.unclassified.length ? `${current.inventory.unclassified.length} unclassified line(s)` : 'QB section and net bridge'} /></div>
        <h3 className="report-subhead">Full P&amp;L by management subgroup</h3><SubgroupMatrix data={data} monthA={monthA} monthB={monthB} onOpen={setDetail} /><p className="report-footnote">Click a value for QB accounts and journal entries. Intercompany remains in reported totals. A MoM change is shown only when the same entities are present in both months.</p>
      </section>}
      {view === 'ytd' && <section className="report-panel"><div className="report-section-head"><div><span>MONTHLY TREND / YEAR TO DATE</span><h2>{scopeName(entity)} · Jan–{MONTHS[monthB - 1]} {year}</h2></div></div>
        <div className="report-metric-picker"><label>Metric <select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}><option value="netIncome">Net income</option><option value="revenue">Revenue (including other income)</option><option value="expense">Expenses (including other expenses)</option>{choices.map((key) => { const [kind, group] = key.split('|') as [PnlKind, PnlGroup]; return <option key={key} value={`group:${key}`}>{KIND_NAMES[kind]} · {PNL_GROUPS[group]}</option> })}</select></label></div>
        <YtdTrend data={data} entity={entity} month={monthB} metric={metric} onOpen={setDetail} />
      </section>}
      {view === 'slides' && <section className="report-deck" id="report-deck"><div className="report-deck-controls"><strong>{SLIDES[slideIndex].title}</strong><span>{slideIndex + 1} / {SLIDES.length}</span><button onClick={() => document.getElementById('report-deck')?.requestFullscreen?.()}>Fullscreen</button><button onClick={() => window.print()}>Export PDF</button></div>
        {priorError && <div className="report-warning">Prior-year P&amp;L unavailable. YTD comparison will show gaps.</div>}
        <Coverage data={data} year={year} month={monthB} />
        <Slide slide={SLIDES[slideIndex]} data={data} prior={prior} monthA={monthA} monthB={monthB} year={year} note={notes[`${slideIndex}`] ?? ''} onNote={saveNote} editable />
        <div className="report-deck-nav"><button disabled={slideIndex === 0} onClick={() => setSlideIndex((index) => index - 1)}>← Previous</button><select aria-label="Select slide" value={slideIndex} onChange={(event) => setSlideIndex(Number(event.target.value))}>{SLIDES.map((slide, index) => <option key={slide.id} value={index}>{index + 1}. {slide.title}</option>)}</select><button disabled={slideIndex === SLIDES.length - 1} onClick={() => setSlideIndex((index) => index + 1)}>Next →</button></div>
        <div className="report-print-deck">{SLIDES.map((slide, index) => <Slide key={slide.id} slide={slide} data={data} prior={prior} monthA={monthA} monthB={monthB} year={year} note={notes[`${index}`] ?? ''} editable={false} />)}</div>
      </section>}
      {detail && <ReportValueDrill key={JSON.stringify(detail)} data={data} detail={detail} onClose={() => setDetail(null)} />}
    </>}
  </main>
}
