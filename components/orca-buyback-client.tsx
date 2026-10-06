'use client'

import { useMemo, useState } from 'react'
import snapshot from '@/lib/report/orca-buyback-data.json'

type CellValue = string | number | boolean | null
type SheetRow = { n: number; c: Record<string, CellValue>; f?: Record<string, string> }
type Workbook = { source: string; asOf: string; sheets: Record<string, SheetRow[]> }
const book = snapshot as unknown as Workbook
const sheets = book.sheets
const row = (sheet: string, n: number) => sheets[sheet]?.find((entry) => entry.n === n)
const value = (sheet: string, n: number, col: string) => row(sheet, n)?.c[col] ?? null
const number = (sheet: string, n: number, col: string) => Number(value(sheet, n, col) ?? 0)
const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
const units = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(n)
const text = (v: CellValue) => v == null ? '—' : typeof v === 'number' ? units(v) : String(v)
const sheetNames = Object.keys(sheets)
type Section = 'overview' | 'execution' | 'ledger' | 'positions' | 'actions' | 'source'

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return <section className="buyback-card"><div className="buyback-card-head"><h3>{title}</h3>{note && <span>{note}</span>}</div>{children}</section>
}

function Table({ sheet, header, from, to, columns, filter }: { sheet: string; header: number; from: number; to: number; columns?: string[]; filter?: string }) {
  const headers = row(sheet, header)?.c ?? {}
  const cols = columns ?? Object.keys(headers)
  const entries = sheets[sheet].filter((item) => item.n >= from && item.n <= to && (!filter || JSON.stringify(item.c).toLowerCase().includes(filter.toLowerCase())))
  return <div className="buyback-table-wrap"><table className="buyback-table"><thead><tr>{cols.map((col) => <th key={col}>{text(headers[col] ?? col)}</th>)}</tr></thead><tbody>{entries.map((item) => <tr key={item.n} className={item.n === 27 && sheet === 'Vault Ledger' ? 'buyback-correction' : undefined}>{cols.map((col) => <td key={col} title={item.f?.[col] ? `Workbook formula: ${item.f[col]}` : undefined}>{text(item.c[col] ?? null)}</td>)}</tr>)}{!entries.length && <tr><td colSpan={cols.length}>No matching rows.</td></tr>}</tbody></table></div>
}

function SummaryLines({ from, to }: { from: number; to: number }) {
  return <div className="buyback-lines">{sheets.Summary.filter((entry) => entry.n >= from && entry.n <= to && entry.c.B != null).map((entry) => <div key={entry.n}><span>{text(entry.c.A)}</span><strong>{entry.n === 5 || (entry.n >= 30 && entry.n <= 36) ? units(Number(entry.c.B)) + ' ORCA' : entry.n === 7 ? usd(Number(entry.c.B)) + ' / ORCA' : usd(Number(entry.c.B))}</strong>{entry.c.D && <small>{text(entry.c.D)}</small>}</div>)}</div>
}

function Overview() {
  const funding = number('Summary', 20, 'B')
  const accounted = number('Summary', 26, 'B')
  const ledgerUsd = number('Vault Ledger', 145, 'G')
  const holdingsUsd = number('Holdings', 5, 'C')
  const bought = number('Summary', 5, 'B')
  const held = number('Summary', 35, 'B')
  return <>
    <div className="buyback-kpis">
      <div><span>ORCA acquired</span><strong>{units(bought)}</strong><small>Market purchases + internal swaps</small></div>
      <div><span>Net USDC spent</span><strong>{usd(number('Summary', 6, 'B'))}</strong><small>Option premiums excluded</small></div>
      <div><span>Blended price</span><strong>{usd(number('Summary', 7, 'B'))}</strong><small>USDC per ORCA</small></div>
      <div><span>Program USDC available</span><strong>{usd(number('Summary', 17, 'B'))}</strong><small>After the US$249,375 severance earmark</small></div>
    </div>
    <div className="buyback-grid"><Card title="Program liquidity" note="Amounts in USDC"><SummaryLines from={10} to={17} /></Card><Card title="US$10m reconciliation" note="Source workbook · dust retained"><SummaryLines from={20} to={27} /><p className="buyback-check">Independent check: funded − accounted = {usd(funding - accounted)}.</p></Card></div>
    <div className="buyback-grid"><Card title="Where purchased ORCA sits" note="Program principal only"><SummaryLines from={30} to={36} /><p className="buyback-check">Independent check: holdings − purchases = {units(held - bought)} ORCA. The difference reflects balance precision in the source.</p></Card><Card title="Balance controls"><div className="buyback-lines"><div><span>Buyback vault · on-chain USDC</span><strong>{usd(holdingsUsd)}</strong></div><div><span>Vault ledger · running USDC</span><strong>{usd(ledgerUsd)}</strong></div><div><span>Ledger minus chain</span><strong>{usd(ledgerUsd - holdingsUsd)}</strong></div><div><span>Phantom USDC / ORCA checks</span><strong>{usd(number('Phantom Wallets', 17, 'F'))} / {units(number('Phantom Wallets', 19, 'I'))}</strong></div><div><span>Velar unaccounted collateral</span><strong>{usd(number('Velar Options', 22, 'F'))}</strong></div></div><p className="buyback-check">Values are the workbook snapshot, not live wallet balances.</p></Card></div>
  </>
}

function Execution() {
  return <>
    <div className="buyback-source-note">The workbook’s Open Items records July severance as a confirmed permanent use and Vamient as confirmed with supporting documentation. The older Channels descriptions still say “Open” and “Medium”; both original entries remain visible below for audit.</div>
    <Card title="Purchase channels" note="USDC sent − principal returned − collateral = net spent"><Table sheet="Channels" header={4} from={5} to={13} /></Card>
    <Card title="Other uses and assets on loan"><Table sheet="Channels" header={16} from={17} to={19} columns={['A','B','C','D','K']} /><div className="buyback-spacer" /><Table sheet="Channels" header={21} from={22} to={23} columns={['A','B','C','H','K']} /></Card>
    <Card title="Phantom OB1–OB8" note="Circle funding is recycled: OB1’s US$70k return is counted once"><Table sheet="Phantom Wallets" header={4} from={5} to={13} /></Card>
    <Card title="Market-maker events" note="Wintermute · FlowDesk · Vamient · Velar"><Table sheet="Market Makers" header={4} from={5} to={24} /></Card>
    <Card title="Market-maker bridge"><Table sheet="Market Makers" header={28} from={29} to={33} /><div className="buyback-small-notes">FlowDesk, Velar and Vamient inputs and ledger tie-outs are preserved in Source &amp; Audit.</div></Card>
    <Card title="Internal swaps"><Table sheet="Internal Swaps" header={4} from={5} to={25} /></Card>
  </>
}

function Ledger() {
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState('')
  const categories = useMemo(() => [...new Set(sheets['Vault Ledger'].filter((r) => r.n >= 5).map((r) => String(r.c.I ?? '')))].sort(), [])
  const all = sheets['Vault Ledger'].filter((r) => r.n >= 5 && (!channel || r.c.I === channel) && (!query || JSON.stringify(r.c).toLowerCase().includes(query.toLowerCase())))
  return <Card title="Buyback vault ledger" note="141 movements · Fireblocks + on-chain correction"><div className="buyback-filters"><label>Channel <select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All channels</option>{categories.map((name) => <option key={name}>{name}</option>)}</select></label><label>Search <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hash, counterparty, note, amount…" /></label><span>{all.length} movements</span></div><div className="buyback-table-wrap"><table className="buyback-table"><thead><tr>{Object.values(row('Vault Ledger', 4)?.c ?? {}).map((header, i) => <th key={i}>{text(header)}</th>)}</tr></thead><tbody>{all.map((entry) => <tr key={entry.n} className={entry.n === 27 ? 'buyback-correction' : undefined}>{'ABCDEFGHIJKLMNO'.split('').map((col) => <td key={col} title={entry.f?.[col]}>{text(entry.c[col] ?? null)}</td>)}</tr>)}{!all.length && <tr><td colSpan={15}>No matching movements.</td></tr>}</tbody></table></div><p className="buyback-small-notes">Highlighted row 27 adds the US$29,970 Jupiter leg present on-chain but missing from the Fireblocks export. Dust and test transfers remain in the ledger for balance reconciliation.</p></Card>
}

function Positions() {
  return <>
    <Card title="Where assets sit" note="On-chain balances as of 1 Oct 2026; program and non-program funds separated"><Table sheet="Holdings" header={4} from={5} to={13} /><div className="buyback-small-notes">Ledger vs on-chain checks: USDC {usd(number('Holdings', 17, 'C'))}; ORCA {units(number('Holdings', 17, 'D'))}.</div></Card>
    <Card title="Velar puts and collateral" note="As of 1 Oct: two open puts, US$500k collateral"><Table sheet="Velar Options" header={4} from={5} to={14} /><div className="buyback-lines buyback-compact"><div><span>USDC sent</span><strong>{usd(number('Velar Options', 17, 'F'))}</strong></div><div><span>Used at exercises</span><strong>{usd(number('Velar Options', 18, 'F') + number('Velar Options', 20, 'F'))}</strong></div><div><span>Collateral on open puts</span><strong>{usd(number('Velar Options', 21, 'F'))}</strong></div><div><span>Unaccounted</span><strong>{usd(number('Velar Options', 22, 'F'))}</strong></div><div><span>Premiums still owed (outside program)</span><strong>{usd(number('Velar Options', 24, 'H'))}</strong></div></div></Card>
    <Card title="xORCA arbitrage" note="Principal to return: 100,000 ORCA; profit stays with OpCo"><Table sheet="xORCA Arb" header={4} from={5} to={18} /><div className="buyback-lines buyback-compact">{[22,23,24,25,26,27,30,31,32,35,36].map((n) => <div key={n}><span>{text(value('xORCA Arb', n, 'A'))}</span><strong>{n === 26 ? (number('xORCA Arb', n, 'E') * 100).toFixed(2) + '%' : units(number('xORCA Arb', n, 'E')) + ' ORCA'}</strong></div>)}</div></Card>
  </>
}

function Actions() {
  return <div className="buyback-actions">{sheets['Open Items'].filter((r) => r.n >= 5).map((entry) => <article key={entry.n} className="buyback-card"><div className="buyback-action-top"><span>#{text(entry.c.A)}</span><strong>{text(entry.c.C)}</strong><em>{text(entry.c.E)}</em></div><p>{text(entry.c.B)}</p><div><b>Follow-up from workbook</b> {text(entry.c.D)}</div></article>)}</div>
}

function Source() {
  const [sheet, setSheet] = useState('Sources & Method')
  return <>
    <Card title="Sources and methodology" note="Original workbook text"><ol className="buyback-method">{sheets['Sources & Method'].filter((r) => r.n >= 3).map((r) => <li key={r.n}>{text(r.c.A)}</li>)}</ol></Card>
    <Card title="Complete workbook detail" note="All 11 original sheets · 379 populated rows · 794 cached formulas"><div className="buyback-filters"><label>Source sheet <select value={sheet} onChange={(e) => setSheet(e.target.value)}>{sheetNames.map((name) => <option key={name}>{name}</option>)}</select></label><span>{sheets[sheet].length} populated rows</span></div><div className="buyback-table-wrap"><table className="buyback-table"><thead><tr><th>Row</th>{[...new Set(sheets[sheet].flatMap((r) => Object.keys(r.c)))].sort().map((col) => <th key={col}>{col}</th>)}</tr></thead><tbody>{sheets[sheet].map((entry) => <tr key={entry.n}><th>{entry.n}</th>{[...new Set(sheets[sheet].flatMap((r) => Object.keys(r.c)))].sort().map((col) => <td key={col} title={entry.f?.[col] ? `Workbook formula: ${entry.f[col]}` : undefined}>{text(entry.c[col] ?? null)}</td>)}</tr>)}</tbody></table></div><p className="buyback-small-notes">Formula cells show their saved Excel results; hover a result for the original formula. This is a dated, read-only snapshot. No live Fireblocks, Circle or Solscan refresh is implied.</p></Card>
  </>
}

const tabs: [Section, string][] = [['overview','Overview'], ['execution','Execution'], ['ledger','Vault ledger'], ['positions','Holdings & options'], ['actions','Open items'], ['source','Source & audit']]
export function OrcaBuybackClient() {
  const [section, setSection] = useState<Section>('overview')
  return <div className="buyback-page"><div className="buyback-head"><div><span>ORCA · BUYBACK PROGRAM</span><h2>US$10m reconciliation</h2><p>Snapshot as of 1 Oct 2026 · source: {book.source}</p></div><span className="buyback-snapshot">Historical snapshot · no live sync</span></div><div className="buyback-subtabs" role="tablist" aria-label="ORCA buyback sections">{tabs.map(([key, label]) => <button type="button" role="tab" aria-selected={section === key} className={section === key ? 'active' : ''} key={key} onClick={() => setSection(key)}>{label}</button>)}</div>{section === 'overview' && <Overview />}{section === 'execution' && <Execution />}{section === 'ledger' && <Ledger />}{section === 'positions' && <Positions />}{section === 'actions' && <Actions />}{section === 'source' && <Source />}</div>
}
