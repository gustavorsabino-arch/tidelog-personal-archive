'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { fmtUSD } from '@/lib/format'
import { ENTITIES } from '@/lib/constants'
import { PNL_GROUPS, type PnlGroup, type PnlKind } from '@/lib/report/pnl-inventory'
import { getFinancialMonth, getYtdSummary, type FinancialMonth, type PresentationFinancials } from '@/lib/presentation/financials'
import type { QboEntity } from '@/lib/qb/config'

type Entity = QboEntity | 'All'
type View = 'mom' | 'ytd' | 'slides'
type Metric = 'revenue' | 'expense' | 'netIncome' | `group:${PnlKind}|${PnlGroup}`
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

function metricAmount(row: FinancialMonth | null, metric: Metric): number | null {
  if (!row) return null
  if (metric === 'revenue') return totalRevenue(row)
  if (metric === 'expense') return totalExpense(row)
  if (metric === 'netIncome') return row.totals.netIncome
  return groupAmount(row, metric.slice(6) as GroupKey)
}

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

function Stat({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
  return <div className="report-stat"><span>{label}</span><strong>{money(value)}</strong>{detail && <small>{detail}</small>}</div>
}

function EntityComparison({ data, year, monthA, monthB }: { data: PresentationFinancials; year: number; monthA: number; monthB: number }) {
  return <div className="report-entity-grid">{ENTITIES.map((entity) => {
    const a = getFinancialMonth(data, entity, monthA), b = getFinancialMonth(data, entity, monthB)
    const current = b?.totals.netIncome, previous = a?.totals.netIncome
    return <article className="report-entity" key={entity} style={{ borderTopColor: ENTITY_COLORS[entity] }}>
      <header><strong>{entity}</strong><span>{b ? 'QB P&L' : 'Missing cache'}</span></header>
      <dl><div><dt>Revenue</dt><dd>{money(totalRevenue(b))}</dd></div><div><dt>Expenses</dt><dd>{money(totalExpense(b))}</dd></div><div className="report-emphasis"><dt>Net income</dt><dd>{money(current)}</dd></div></dl>
      <footer>{a && b ? `Net vs ${MONTHS[monthA - 1]}: ${money(current! - previous!)}` : `MoM unavailable · ${MONTHS[monthA - 1]} to ${MONTHS[monthB - 1]} ${year}`}</footer>
    </article>
  })}</div>
}

function SubgroupMatrix({ data, year, monthA, monthB, compact = false }: { data: PresentationFinancials; year: number; monthA: number; monthB: number; compact?: boolean }) {
  const a = getFinancialMonth(data, 'All', monthA), b = getFinancialMonth(data, 'All', monthB)
  const keys = groupKeys([a, b])
  const [selected, setSelected] = useState<GroupKey | null>(null)
  const selectedAccounts = selected ? ENTITIES.flatMap((entity) => {
    const month = getFinancialMonth(data, entity, monthB)
    return (month?.inventory.accounts ?? []).filter((account) => `${account.kind}|${account.group}` === selected && account.amount !== 0).map((account) => ({ entity, account }))
  }) : []
  return <>
    <div className="report-table-scroll"><table className="report-table"><thead><tr><th>QB section / subgroup</th>{ENTITIES.map((entity) => <th key={entity}>{entity}</th>)}<th>Reported total</th><th>MoM change</th></tr></thead><tbody>
      {keys.map((key, index) => {
        const [kind, group] = key.split('|') as [PnlKind, PnlGroup]
        const prev = keys[index - 1]?.split('|')[0]
        const amount = b ? groupAmount(b, key) : null
        const change = a && b && a.presentEntities.join(',') === b.presentEntities.join(',') ? groupAmount(b, key) - groupAmount(a, key) : null
        return <tr key={key} className={selected === key ? 'selected' : ''}>
          <td>{kind !== prev && <span className="report-kind">{KIND_NAMES[kind]}</span>}<button className="report-row-button" onClick={() => setSelected(selected === key ? null : key)} aria-expanded={selected === key}>{PNL_GROUPS[group]}</button></td>
          {ENTITIES.map((entity) => <td key={entity}>{getFinancialMonth(data, entity, monthB) ? money(groupAmount(getFinancialMonth(data, entity, monthB), key)) : '—'}</td>)}
          <td className="report-strong">{money(amount)}</td><td>{money(change)}</td>
        </tr>
      })}
      {!keys.length && <tr><td colSpan={7}>No cached P&L for the selected months.</td></tr>}
    </tbody></table></div>
    {selected && !compact && <div className="report-detail"><h3>{PNL_GROUPS[selected.split('|')[1] as PnlGroup]} · {MONTHS[monthB - 1]} {year}</h3>
      {selectedAccounts.length ? <ul>{selectedAccounts.map(({ entity, account }, i) => <li key={`${entity}-${account.glCode}-${i}`}><span>{entity} · {account.glCode ?? 'No code'} · {account.label}</span><strong>{exact(account.amount)}</strong><Link href={`/pnl?entity=${entity}&mode=month&year=${year}&month=${monthB}`}>Open P&amp;L</Link></li>)}</ul> : <p>No posted amount in the selected month.</p>}
    </div>}
  </>
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
  return <div className="report-chart-wrap"><svg className="report-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Monthly ${metric} by entity through ${MONTHS[month - 1]} ${data.year}`}>
    {ticks.map((value, index) => <g key={index}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#b7c3d0" strokeOpacity=".23" /><text x={left - 12} y={y(value) + 4} textAnchor="end" fill="#68798d" fontSize="12">{chartMoney(value)}</text></g>)}
    {Array.from({ length: month }, (_, index) => <text key={index} x={x(index)} y={height - 12} textAnchor="middle" fill="#68798d" fontSize="12">{MONTHS[index]}</text>)}
    {series.map(({ scope, values: points }) => {
      const color = scope === 'All' ? '#c79a30' : ENTITY_COLORS[scope]
      return <g key={scope}>{points.slice(1).map((value, index) => value == null || points[index] == null ? null : <line key={index} x1={x(index)} y1={y(points[index]!)} x2={x(index + 1)} y2={y(value)} stroke={color} strokeWidth={scope === 'All' ? 3.5 : 2} />)}
        {points.map((value, index) => value == null ? null : <circle key={index} cx={x(index)} cy={y(value)} r={scope === 'All' ? 4 : 3} fill={color}><title>{scope} · {MONTHS[index]}: {exact(value)}</title></circle>)}
      </g>
    })}
  </svg><div className="report-legend">{series.map(({ scope }) => <span key={scope}><i style={{ background: scope === 'All' ? '#c79a30' : ENTITY_COLORS[scope] }} />{scope === 'All' ? 'Reported group' : scope}</span>)}</div></div>
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
  const [slideIndex, setSlideIndex] = useState(0)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const { data, error, isLoading } = useSWR<PresentationFinancials>(`/api/report/financials?year=${year}`, apiFetch)
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
  const ytd = data ? getYtdSummary(data, entity, monthB) : null

  useEffect(() => {
    if (metric.startsWith('group:') && !choices.includes(metric.slice(6) as GroupKey)) setMetric('netIncome')
  }, [choices, metric])

  return <main className="report-page">
    <div className="page-header"><div><div className="page-title">Report</div><div className="page-sub">QuickBooks P&amp;L · management categories · C-level presentation</div></div></div>
    <div className="report-toolbar"><div className="report-tabs" role="tablist" aria-label="Report views">{([['mom', 'MoM Comparison'], ['ytd', 'YTD Trend'], ['slides', 'Presentation']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</div>
      <label>Year <select value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item}>{item}</option>)}</select></label>
      {view !== 'slides' && <label>Entity <select value={entity} onChange={(event) => setEntity(event.target.value as Entity)}><option value="All">Reported group</option>{ENTITIES.map((name) => <option key={name}>{name}</option>)}</select></label>}
      {view === 'mom' && <label>Compare <select value={monthA} onChange={(event) => setMonthA(Number(event.target.value))}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>}
      <label>{view === 'ytd' ? 'Through' : 'Month'} <select value={monthB} onChange={(event) => setMonthB(Number(event.target.value))}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
    </div>
    {isLoading && !data && <div className="report-empty">Loading cached QuickBooks P&amp;Ls…</div>}
    {error && <div className="report-warning" role="alert">Could not load P&amp;L data: {error instanceof Error ? error.message : String(error)}</div>}
    {data && <>
      {view === 'mom' && <section className="report-panel"><div className="report-section-head"><div><span>MONTHLY COMPARISON</span><h2>{MONTHS[monthA - 1]} vs {MONTHS[monthB - 1]} {year}</h2></div><p>QB values as reported · signed credits and losses</p></div><Coverage data={data} year={year} month={monthB} />
        <EntityComparison data={data} year={year} monthA={monthA} monthB={monthB} />
        <div className="report-stats"><Stat label="Revenue" value={totalRevenue(current)} detail={comparable ? `MoM ${money(totalRevenue(current)! - totalRevenue(earlier)!)}` : 'Comparison unavailable'} /><Stat label="Expenses" value={totalExpense(current)} detail={comparable ? `MoM ${money(totalExpense(current)! - totalExpense(earlier)!)}` : 'Comparison unavailable'} /><Stat label="Net income" value={current?.totals.netIncome ?? null} detail={comparable ? `MoM ${money(current!.totals.netIncome - earlier!.totals.netIncome)}` : 'Comparison unavailable'} /><Stat label="Reconciliation residual" value={current ? Math.abs(current.inventory.netIncomeResidual) + current.inventory.sectionResiduals.reduce((sum, item) => sum + Math.abs(item.amount), 0) : null} detail={current?.inventory.unclassified.length ? `${current.inventory.unclassified.length} unclassified line(s)` : 'QB section and net bridge'} /></div>
        <h3 className="report-subhead">Full P&amp;L by management subgroup</h3><SubgroupMatrix data={data} year={year} monthA={monthA} monthB={monthB} /><p className="report-footnote">Click a subgroup to inspect its QB accounts. Intercompany remains in reported totals. A MoM change is shown only when the same entities are present in both months.</p>
      </section>}
      {view === 'ytd' && <section className="report-panel"><div className="report-section-head"><div><span>MONTHLY TREND / YEAR TO DATE</span><h2>{scopeName(entity)} · Jan–{MONTHS[monthB - 1]} {year}</h2></div></div><Coverage data={data} year={year} month={monthB} entity={entity} />
        <div className="report-metric-picker"><label>Metric <select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}><option value="netIncome">Net income</option><option value="revenue">Revenue (including other income)</option><option value="expense">Expenses (including other expenses)</option>{choices.map((key) => { const [kind, group] = key.split('|') as [PnlKind, PnlGroup]; return <option key={key} value={`group:${key}`}>{KIND_NAMES[kind]} · {PNL_GROUPS[group]}</option> })}</select></label></div>
        <Trend data={data} entity={entity} month={monthB} metric={metric} />
        <div className="report-stats"><Stat label="YTD revenue" value={ytd?.months ? ytd.totals.revenue + ytd.totals.otherIncome : null} /><Stat label="YTD expenses" value={ytd?.months ? ytd.totals.expense + ytd.totals.otherExpense : null} /><Stat label="YTD net income" value={ytd?.months ? ytd.totals.netIncome : null} /><Stat label="Coverage" value={null} detail={`${ytd?.months ?? 0}/${monthB} months · ${ytd?.complete ? 'complete' : 'partial'}`} /></div>
        <div className="report-table-scroll"><table className="report-table"><thead><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Net income</th><th>Entities</th></tr></thead><tbody>{Array.from({ length: monthB }, (_, index) => { const row = getFinancialMonth(data, entity, index + 1); return <tr key={index}><td>{MONTHS[index]}</td><td>{money(totalRevenue(row))}</td><td>{money(totalExpense(row))}</td><td>{money(row?.totals.netIncome)}</td><td>{row?.presentEntities.join(', ') || 'Missing'}</td></tr> })}</tbody></table></div>
        <p className="report-footnote">Each chart point uses the entities cached for that month. Check the coverage column before comparing group points.</p>
      </section>}
      {view === 'slides' && <section className="report-deck" id="report-deck"><div className="report-deck-controls"><strong>{SLIDES[slideIndex].title}</strong><span>{slideIndex + 1} / {SLIDES.length}</span><button onClick={() => document.getElementById('report-deck')?.requestFullscreen?.()}>Fullscreen</button><button onClick={() => window.print()}>Export PDF</button></div>
        {priorError && <div className="report-warning">Prior-year P&amp;L unavailable. YTD comparison will show gaps.</div>}
        <Coverage data={data} year={year} month={monthB} />
        <Slide slide={SLIDES[slideIndex]} data={data} prior={prior} monthA={monthA} monthB={monthB} year={year} note={notes[`${slideIndex}`] ?? ''} onNote={saveNote} editable />
        <div className="report-deck-nav"><button disabled={slideIndex === 0} onClick={() => setSlideIndex((index) => index - 1)}>← Previous</button><select aria-label="Select slide" value={slideIndex} onChange={(event) => setSlideIndex(Number(event.target.value))}>{SLIDES.map((slide, index) => <option key={slide.id} value={index}>{index + 1}. {slide.title}</option>)}</select><button disabled={slideIndex === SLIDES.length - 1} onClick={() => setSlideIndex((index) => index + 1)}>Next →</button></div>
        <div className="report-print-deck">{SLIDES.map((slide, index) => <Slide key={slide.id} slide={slide} data={data} prior={prior} monthA={monthA} monthB={monthB} year={year} note={notes[`${index}`] ?? ''} editable={false} />)}</div>
      </section>}
    </>}
  </main>
}
