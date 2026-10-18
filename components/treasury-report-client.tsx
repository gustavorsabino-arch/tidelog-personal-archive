'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch, apiPost } from '@/lib/api'
import { BANK_TOKENS, ENTITIES, ENTITY_COLORS, STABLE_TOKENS, TOKEN_COLORS } from '@/lib/constants'
import { fmtNum, fmtUSD } from '@/lib/format'
import type { TreasuryOverview } from '@/lib/types'

const share = (part: number, whole: number) => whole > 0 ? `${(part / whole * 100).toFixed(1)}%` : '—'
const amount = (n: number) => fmtUSD(n)
type HistoricalProgress = { status: 'loading'; completed: number; total: number; retryAfterMs: number }

export function TreasuryReportClient() {
  const [entity, setEntity] = useState('')
  const [asOf, setAsOf] = useState('')
  const [walletSearch, setWalletSearch] = useState('')
  const [refreshingBalances, setRefreshingBalances] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState('')
  const query = new URLSearchParams({ ...(entity ? { entity } : {}), ...(asOf ? { as_of: asOf } : {}) })
  const { data: response, error, isLoading, isValidating, mutate } = useSWR<TreasuryOverview | HistoricalProgress>(
    `/api/treasury/overview?${query}`, apiFetch<TreasuryOverview | HistoricalProgress>,
    { refreshInterval: (latest) => latest && 'status' in latest ? latest.retryAfterMs : 0 },
  )
  const progress = response && 'status' in response ? response : null
  // Never render the previous snapshot under a newly selected historical date.
  // SWR can retain its last successful response when the new request fails.
  const data = response && !('status' in response) && (!asOf || response.snapshotDate === asOf)
    ? response : null
  const total = data?.grandTotalUSD ?? 0
  const snapshotAgeDays = data?.snapshotDate
    ? Math.floor((Date.now() - Date.parse(`${data.snapshotDate}T00:00:00Z`)) / 86_400_000)
    : null
  const entities = entity ? [entity] : [
    ...ENTITIES,
    ...Object.keys(data?.entityTotals ?? {}).filter((name) => !ENTITIES.some((known) => known === name)).sort(),
  ]
  const assets = useMemo(() => Object.entries(data?.tokenTotals ?? {})
    .filter(([, row]) => row.amount !== 0 || row.usd !== 0)
    .sort((a, b) => b[1].usd - a[1].usd), [data])
  const wallets = useMemo(() => [...(data?.wallets ?? [])]
    .filter((w) => `${w.label} ${w.entity} ${w.address}`.toLowerCase().includes(walletSearch.trim().toLowerCase()))
    .sort((a, b) => b.totalUSD - a.totalUSD), [data, walletSearch])
  // These balances are already included in Overview's portfolio total.
  const protocolWallets = useMemo(() => (data?.wallets ?? [])
    .filter((wallet) => /^Treasury Management\s*[-–]/i.test(wallet.label))
    .sort((a, b) => b.totalUSD - a.totalUSD), [data])
  const protocolTotal = protocolWallets.reduce((sum, wallet) => sum + wallet.totalUSD, 0)
  const bank = assets.reduce((sum, [token, row]) => sum + (BANK_TOKENS.has(token) ? row.usd : 0), 0)
  const stable = assets.reduce((sum, [token, row]) => sum + (STABLE_TOKENS.has(token) && !BANK_TOKENS.has(token) ? row.usd : 0), 0)
  const other = total - bank - stable
  const unpriced = assets.filter(([token, row]) => !STABLE_TOKENS.has(token) && row.amount !== 0 && data?.prices[token] == null).map(([token]) => token)
  async function refreshOnchain() {
    setRefreshingBalances(true)
    setRefreshMessage('')
    try {
      const result = await apiPost<{ succeeded: number; failed: number; skipped?: number }>('/api/admin/cron/fetch-balances', {})
      setRefreshMessage(`${result.succeeded} Solana wallet(s) fetched; ${result.failed} failed; ${result.skipped ?? 0} unsupported.`)
      await mutate()
    } catch (err) {
      setRefreshMessage(err instanceof Error ? err.message : 'Could not fetch on-chain balances')
    } finally {
      setRefreshingBalances(false)
    }
  }

  return <div className="treasury-report">
    <header className="treasury-report-header">
      <div><div className="page-title">Treasury</div><div className="page-sub">Portfolio exposure and concentration from the same wallet balances as Overview.</div></div>
      <div className="treasury-report-stamp">{data?.snapshotDate ? (asOf ? `On-chain date: ${data.snapshotDate}` : `Newest saved record: ${data.snapshotDate}`) : 'Awaiting balance data'}{data?.fetchedAt ? <small>{asOf ? 'Verified' : 'Most recently fetched'} {new Date(data.fetchedAt).toLocaleString()}</small> : null}</div>
    </header>
    <div className="controls-bar treasury-report-controls">
      <label>Entity<select className="fsel" value={entity} onChange={(event) => setEntity(event.target.value)}><option value="">All entities</option>{ENTITIES.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>As of (UTC close)<input className="fsearch" type="date" value={asOf} max={new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)} onChange={(event) => setAsOf(event.target.value)} /></label>
      {asOf && <button className="fsel" type="button" onClick={() => setAsOf('')}>Today</button>}
      <button className="fetch-btn" type="button" onClick={() => void mutate()} disabled={isValidating}>{isValidating ? '⟳ Reloading…' : '⟳ Reload report'}</button>
      {!asOf && <button className="fetch-btn" type="button" onClick={() => void refreshOnchain()} disabled={refreshingBalances}>{refreshingBalances ? 'Fetching wallets…' : 'Fetch Solana balances now'}</button>}
    </div>
    {refreshMessage && <div className="report-warning" role="status">{refreshMessage}</div>}
    {error && <div className="status-bar"><span className="status-dot warn" /><span className="status-text">{error instanceof Error ? error.message : 'Could not load treasury balances'}</span></div>}
    {progress ? <div className="card treasury-report-loading" role="status">Verifying historical on-chain balances: {progress.completed} of {progress.total} wallet assets. The report will appear when all balances are checked.{progress.retryAfterMs >= 30_000 ? ' Helius is limiting requests; retrying after its cooldown.' : ''}</div> : isLoading && !data ? <div className="card treasury-report-loading">Loading portfolio report…</div> : data ? <>
      {!asOf && snapshotAgeDays != null && snapshotAgeDays > 1 && <div className="report-warning" role="status">Newest balance record is {snapshotAgeDays} days old ({data.snapshotDate}); other wallets can be older. USD values may use newer prices on those saved quantities. “Reload report” does not fetch wallet balances.</div>}
      <div className="treasury-report-scope">{asOf ? 'Historical on-chain check · All tracked Solana spot balances queried for the selected UTC close, including zeroes. Uses today’s wallet classification. EVM, LPs, decoded protocol positions and manual balances are excluded. Helius may undercount a mint held in multiple token accounts.' : 'Latest saved snapshot · Solana wallet balances plus manually tracked bank/protocol positions; manual values are not on-chain verified. EVM balances, LPs and decoded protocol positions are outside this dataset.'}{unpriced.length ? ` Missing price for ${unpriced.join(', ')}; their USD contribution is zero in both Overview and Reports.` : ''}</div>
      {data.coverage && <div className="report-warning" role="status">{asOf ? 'Historical Solana coverage' : 'Saved Solana coverage'}: {data.coverage.verifiedSolWallets}/{data.coverage.expectedSolWallets} internal wallets · {data.coverage.manualWallets} manual and {data.coverage.otherChainWallets} other-chain wallets {asOf ? 'excluded' : 'tracked separately or unsupported'}.
        {data.coverage.newInternalWallets.length > 0 && <details><summary>{data.coverage.newInternalWallets.length} internal wallet(s) added since July 2026 — inspect balance coverage</summary><ul>{data.coverage.newInternalWallets.map((w, index) => <li key={`${w.label}-${index}`}>{w.label} ({w.chain}) · latest saved balance: {w.latestBalanceDate ?? 'none'}</li>)}</ul></details>}
        {data.coverage.newExternalWallets.length > 0 && <details><summary>{data.coverage.newExternalWallets.length} wallet(s) added since July are marked external and excluded</summary><ul>{data.coverage.newExternalWallets.map((w, index) => <li key={`${w.label}-${index}`}>{w.label} ({w.chain})</li>)}</ul></details>}
      </div>}
      <div className="treasury-report-kpis">
        <div className="card"><span>Total portfolio</span><strong>{amount(total)}</strong><small>{data.wallets.length} wallets · {entity || 'reported entities'}</small></div>
        <div className="card"><span>Stablecoins</span><strong>{amount(stable)}</strong><small>{share(stable, total)} of portfolio</small></div>
        <div className="card"><span>Bank USD</span><strong>{amount(bank)}</strong><small>{share(bank, total)} of portfolio</small></div>
        <div className="card"><span>Other spot assets</span><strong>{amount(other)}</strong><small>{share(other, total)} of portfolio</small></div>
      </div>
      <div className="treasury-report-grid">
        <section className="card treasury-report-panel">
          <h2>Allocation by entity</h2><p>All entity labels returned by Overview, including any unmapped wallets.</p>
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
      {protocolWallets.length > 0 && <section className="card treasury-report-panel">
        <h2>Treasury management wallets</h2><p>{amount(protocolTotal)} across {protocolWallets.length} wallets ({share(protocolTotal, total)} of the portfolio). These balances are already included above; this is a breakdown, not an addition. Protocol receipt tokens are valued as they appear in Overview.</p>
        <div className="table-wrap"><table><thead><tr><th>Wallet / protocol</th><th>Entity</th><th>Tracked assets</th><th className="num">USD value</th><th className="num">Share of portfolio</th></tr></thead><tbody>
          {protocolWallets.map((wallet) => <tr key={wallet.address}><td>{wallet.label}</td><td>{wallet.entity}</td><td>{Object.keys(wallet.balances).filter((token) => wallet.balances[token] !== 0).join(', ') || '—'}</td><td className="num">{amount(wallet.totalUSD)}</td><td className="num">{share(wallet.totalUSD, total)}</td></tr>)}
          <tr className="treasury-report-total"><td>Total (included in portfolio)</td><td /><td /><td className="num">{amount(protocolTotal)}</td><td className="num">{share(protocolTotal, total)}</td></tr>
        </tbody></table></div>
      </section>}
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
