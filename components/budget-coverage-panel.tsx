'use client'

import { fmtUSD } from '@/lib/format'
import type { BudgetCoverageState } from '@/lib/budget/types'

type BudgetCoveragePanelProps = {
  coverage: BudgetCoverageState | null
  loading: boolean
  error: string | null
  onMapAccount: (accountNumber: string) => void
}

export function BudgetCoveragePanel({
  coverage,
  loading,
  error,
  onMapAccount,
}: BudgetCoveragePanelProps) {
  if (loading) {
    return (
      <div className="status-bar">
        <span className="status-dot loading" />
        <span className="status-text">Loading coverage…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="status-bar">
        <span className="status-dot warn" />
        <span className="status-text">{error}</span>
      </div>
    )
  }

  if (!coverage) {
    return (
      <div className="empty budget-empty-inline">
        <div className="empty-icon">∅</div>
        <div>Fetch P&amp;L data from QuickBooks to see mapped and unmapped budget coverage.</div>
      </div>
    )
  }

  const pctColor = coverage.coveragePct >= 0.95 ? 'var(--green)' : coverage.coveragePct >= 0.8 ? 'var(--orange)' : 'var(--red)'

  return (
    <div className="section">
      <div className="section-header budget-section-header">
        <div>
          <span className="section-title">Coverage</span>
          <div className="budget-section-note" style={{ marginTop: 4 }}>
            Compares positive QuickBooks P&amp;L account totals against the saved QB mapping for the selected scope.
          </div>
        </div>
        <span className="budget-section-note">
          {coverage.mappingSource === 'data-branch' ? 'Using saved mapping' : 'Using default mapping'} · {new Date(coverage.fetchedAt).toLocaleString()}
        </span>
      </div>

      <div className="cards-grid budget-coverage-summary-grid">
        <div className="card">
          <div className="card-label">QB Total Expenses</div>
          <div className="card-value">{fmtUSD(coverage.totalQbUsd, 0)}</div>
        </div>
        <div className="card">
          <div className="card-label">Mapped to Budget</div>
          <div className="card-value green">{fmtUSD(coverage.mappedUsd, 0)}</div>
        </div>
        <div className="card">
          <div className="card-label">Gap (Unmapped)</div>
          <div className="card-value" style={{ color: coverage.unmappedUsd > 0 ? 'var(--red)' : 'var(--green)' }}>
            {fmtUSD(coverage.unmappedUsd, 0)}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Coverage</div>
          <div className="card-value" style={{ color: pctColor }}>{(coverage.coveragePct * 100).toFixed(1)}%</div>
          <div className="card-bar">
            <div className="card-bar-fill" style={{ width: `${Math.min(coverage.coveragePct * 100, 100)}%`, background: pctColor }} />
          </div>
        </div>
      </div>

      {coverage.unmappedAccounts.length > 0 ? (
        <div className="section" style={{ marginTop: 4 }}>
          <div className="section-header">
            <span className="section-title">Unmapped Accounts</span>
            <span className="budget-section-note">
              {coverage.unmappedAccounts.length} account{coverage.unmappedAccounts.length === 1 ? '' : 's'} · {fmtUSD(coverage.unmappedUsd, 0)}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account #</th>
                  <th>Name</th>
                  <th className="num">Amount</th>
                  <th className="num">% of QB Total</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {coverage.unmappedAccounts.map((entry) => (
                  <tr key={entry.accountNumber}>
                    <td style={{ fontFamily: 'var(--mono)' }}>{entry.accountNumber}</td>
                    <td className="label" style={{ color: 'var(--muted)' }}>{entry.accountName || '—'}</td>
                    <td className="num">{fmtUSD(entry.amountUsd, 0)}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{(entry.pctOfTotal * 100).toFixed(1)}%</td>
                    <td className="num">
                      <button className="btn-secondary" type="button" onClick={() => onMapAccount(entry.accountNumber)}>
                        + Map
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="status-bar budget-plan-status">
          <span className="status-dot ok" />
          <span className="status-text">All positive QuickBooks P&amp;L accounts in this scope are mapped to budget lines.</span>
        </div>
      )}

      <div className="section">
        <div className="section-header">
          <span className="section-title">Mapped Accounts</span>
          <span className="budget-section-note">
            {coverage.mappedAccounts.length} account{coverage.mappedAccounts.length === 1 ? '' : 's'} · {fmtUSD(coverage.mappedUsd, 0)}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account #</th>
                <th>Name</th>
                <th>Budget Line</th>
                <th className="num">Amount</th>
                <th className="num">% of QB Total</th>
              </tr>
            </thead>
            <tbody>
              {coverage.mappedAccounts.length > 0 ? coverage.mappedAccounts.map((entry) => (
                <tr key={entry.accountNumber}>
                  <td style={{ fontFamily: 'var(--mono)' }}>{entry.accountNumber}</td>
                  <td className="label" style={{ color: 'var(--muted)' }}>{entry.accountName || '—'}</td>
                  <td className="label">{entry.mappingLine || entry.mappingKey || '—'}</td>
                  <td className="num">{fmtUSD(entry.amountUsd, 0)}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{(entry.pctOfTotal * 100).toFixed(1)}%</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty budget-empty-inline">
                      <div className="empty-icon">∅</div>
                      <div>No mapped accounts were found for the selected scope.</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
