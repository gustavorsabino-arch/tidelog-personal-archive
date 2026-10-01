'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { BANK_TOKENS, ENTITIES, ENTITY_COLORS, STABLE_TOKENS, TOKEN_COLORS } from '@/lib/constants'
import { fmtNum, fmtUSD } from '@/lib/format'
import type { TreasuryOverview } from '@/lib/types'

const share = (part: number, whole: number) => whole > 0 ? `${(part / whole * 100).toFixed(1)}%` : '—'
const amount = (n: number) => fmtUSD(n)

export function TreasuryReportClient() {
  const [entity, setEntity] = useState('')
  const [asOf, setAsOf] = useState('')
  const [walletSearch, setWalletSearch] = useState('')
  const query = new URLSearchParams({ ...(entity ? { entity } : {}), ...(asOf ? { as_of: asOf } : {}) })
  const { data, error, isLoading, isValidating, mutate } = useSWR<TreasuryOverview>(
    `/api/treasury/overview?${query}`, apiFetch<TreasuryOverview>,
  )
  const total = data?.grandTotalUSD ?? 0
  const entities = entity ? [entity] : [...ENTITIES]
  const assets = useMemo(() => Object.entries(data?.tokenTotals ?? {})
    .filter(([, row]) => row.amount !== 0 || row.usd !== 0)
    .sort((a, b) => b[1].usd - a[1].usd), [data])
  const wallets = useMemo(() => [...(data?.wallets ?? [])]
    .filter((w) => `${w.label} ${w.entity} ${w.address}`.toLowerCase().includes(walletSearch.trim().toLowerCase()))
    .sort((a, b) => b.totalUSD - a.totalUSD), [data, walletSearch])
  const bank = assets.reduce((sum, [token, row]) => sum + (BANK_TOKENS.has(token) ? row.usd : 0), 0)
  const stable = assets.reduce((sum, [token, row]) => sum + (STABLE_TOKENS.has(token) && !BANK_TOKENS.has(token) ? row.usd : 0), 0)
  const other = total - bank - stable
  const unpriced = assets.filter(([token, row]) => !STABLE_TOKENS.has(token) && row.amount !== 0 && data?.prices[token] == null).map(([token]) => token)

  return <div className="treasury-report">
    <header className="treasury-report-header">
      <div><div className="page-title">Treasury reports</div><div className="page-sub">Portfolio exposure and concentration from the same wallet balances as Overview.</div></div>
      <div className="treasury-report-stamp">{data?.snapshotDate ? `Balances as of ${data.snapshotDate}` : 'Awaiting balance data'}{data?.fetchedAt ? <small>Last fetched {new Date(data.fetchedAt).toLocaleString()}</small> : null}</div>
    </header>
    <div className="controls-bar treasury-report-controls">
      <label>Entity<select className="fsel" value={entity} onChange={(event) => setEntity(event.target.value)}><option value="">All entities</option>{ENTITIES.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>As of<input className="fsearch" type="date" value={asOf} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setAsOf(event.target.value)} /></label>
      {asOf && <button className="fsel" type="button" onClick={() => setAsOf('')}>Today</button>}
      <button className="fetch-btn" type="button" onClick={() => void mutate()} disabled={isValidating}>{isValidating ? '⟳ Updating…' : '⟳ Refresh'}</button>
    </div>
    {error && <div className="status-bar"><span className="status-dot warn" /><span className="status-text">{error instanceof Error ? error.message : 'Could not load treasury balances'}</span></div>}
    {isLoading && !data ? <div className="card treasury-report-loading">Loading portfolio report…</div> : data ? <>
      <div className="treasury-report-scope">{asOf ? 'Historical snapshot · Solana spot balances only. EVM, LPs and on-chain management positions are not available historically.' : 'Current snapshot · Finance-visible balances tracked in Overview. EVM balances, LPs and on-chain management positions are outside the current snapshot dataset.'}{unpriced.length ? ` Missing price for ${unpriced.join(', ')}; their USD contribution is zero in both Overview and Reports.` : ''}</div>
      <div className="treasury-report-kpis">
        <div className="card"><span>Total portfolio</span><strong>{amount(total)}</strong><small>{data.wallets.length} wallets · {entity || 'reported entities'}</small></div>
        <div className="card"><span>Stablecoins</span><strong>{amount(stable)}</strong><small>{share(stable, total)} of portfolio</small></div>
        <div className="card"><span>Bank USD</span><strong>{amount(bank)}</strong><small>{share(bank, total)} of portfolio</small></div>
        <div className="card"><span>Other spot assets</span><strong>{amount(other)}</strong><small>{share(other, total)} of portfolio</small></div>
      </div>
      <div className="treasury-report-grid">
        <section className="card treasury-report-panel">
          <h2>Allocation by entity</h2><p>Each entity reconciles to the Overview portfolio total.</p>
          <div className="table-wrap"><table><thead><tr><th>Entity</th><th className="num">Wallets</th><th className="num">USD value</th><th className="num">Share</th></tr></thead><tbody>
            {entities.map((name) => { const row = data.entityTotals[name]; return <tr key={name}><td><span className="treasury-report-dot" style={{ background: ENTITY_COLORS[name] ?? 'var(--accent)' }} />{name}</td><td className="num">{row?.walletCount ?? 0}</td><td className="num">{amount(row?.totalUSD ?? 0)}</td><td className="num">{share(row?.totalUSD ?? 0, total)}</td></tr> })}
            <tr className="treasury-report-total"><td>Total</td><td className="num">{data.wallets.length}</td><td className="num">{amount(total)}</td><td className="num">{share(total, total)}</td></tr>
          </tbody></table></div>
        </section>
        <section className="card treasury-report-panel">
          <h2>Asset composition</h2><p>USD exposure by token, priced as in Overview.</p>
          {assets.length ? <div className="treasury-report-bars">{assets.slice(0, 8).map(([token, row]) => <div className="treasury-report-bar-row" key={token}><div><strong>{token}</strong><span>{amount(row.usd)} · {share(row.usd, total)}</span></div><div className="treasury-report-track"><div style={{ width: `${Math.max(0, Math.min(100, total > 0 ? row.usd / total * 100 : 0))}%`, background: TOKEN_COLORS[token] ?? TOKEN_COLORS.default }} /></div></div>)}</div> : <p>No token balances.</p>}
        </section>
      </div>
      <section className="card treasury-report-panel">
        <h2>Exposure by asset and entity</h2><p>USD values; token units shown beneath each asset. Column totals reconcile with the entity allocation above.</p>
        <div className="table-wrap"><table><thead><tr><th>Asset</th>{entities.map((name) => <th key={name} className="num">{name}</th>)}<th className="num">Total USD</th><th className="num">Share</th></tr></thead><tbody>
          {assets.map(([token, row]) => <tr key={token}><td><strong>{token}</strong><small className="treasury-report-units">{fmtNum(row.amount, token === 'SOL' ? 4 : 2)} units</small></td>{entities.map((name) => <td className="num" key={name}>{amount(data.entityTotals[name]?.tokenUsd[token] ?? 0)}</td>)}<td className="num">{amount(row.usd)}</td><td className="num">{share(row.usd, total)}</td></tr>)}
          <tr className="treasury-report-total"><td>Total</td>{entities.map((name) => <td className="num" key={name}>{amount(data.entityTotals[name]?.totalUSD ?? 0)}</td>)}<td className="num">{amount(total)}</td><td className="num">{share(total, total)}</td></tr>
        </tbody></table></div>
      </section>
      <section className="card treasury-report-panel">
        <div className="treasury-report-section-head"><div><h2>Wallet concentration</h2><p>Internal wallets ranked by USD value. Select a wallet in Overview for token and trend details.</p></div><input className="fsearch" aria-label="Search wallets" placeholder="Search wallet or entity…" value={walletSearch} onChange={(event) => setWalletSearch(event.target.value)} /></div>
        <div className="table-wrap"><table><thead><tr><th>Wallet</th><th>Entity</th><th>Chain</th><th>Largest asset</th><th className="num">USD value</th><th className="num">Share</th></tr></thead><tbody>
          {wallets.map((wallet) => { const top = Object.entries(wallet.tokenUsd).sort((a, b) => b[1] - a[1])[0]; return <tr key={wallet.address}><td title={wallet.address}>{wallet.label || `${wallet.address.slice(0, 8)}…${wallet.address.slice(-6)}`}</td><td>{wallet.entity}</td><td>{wallet.chain}</td><td>{top?.[0] ?? '—'}</td><td className="num">{amount(wallet.totalUSD)}</td><td className="num">{share(wallet.totalUSD, total)}</td></tr> })}
          {!wallets.length && <tr><td colSpan={6}>No matching wallets.</td></tr>}
        </tbody></table></div>
      </section>
    </> : null}
  </div>
}
