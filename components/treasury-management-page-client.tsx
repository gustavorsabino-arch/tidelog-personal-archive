'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DataTable } from '@/components/data-table'
import { apiFetch } from '@/lib/api'
import { fmtAddr, fmtDate, fmtDateTime, fmtNum, fmtUSD } from '@/lib/format'
import type {
  TreasuryManagementPosition,
  TreasuryManagementResponse,
} from '@/lib/types'

type TreasuryManagementPageClientProps = {
  initialEntity: string
  initialData: TreasuryManagementResponse
}

export function TreasuryManagementPageClient({
  initialEntity,
  initialData,
}: TreasuryManagementPageClientProps) {
  const [entity, setEntity] = useState(initialEntity)
  const [data, setData] = useState<TreasuryManagementResponse>(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const didHydrate = useRef(false)

  const [protocolFilter, setProtocolFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')
  const [search, setSearch] = useState('')

  async function fetchData(nextEntity: string) {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (nextEntity && nextEntity !== 'All') {
        params.set('entity', nextEntity)
      }
      const query = params.toString()
      const res = await apiFetch<TreasuryManagementResponse>(
        `/api/treasury-management/positions${query ? `?${query}` : ''}`
      )
      setData(res)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!didHydrate.current) {
      didHydrate.current = true
      return
    }
    fetchData(entity)
  }, [entity])

  const protocolOptions = useMemo(() => {
    return [...new Set(data.positions.map(position => position.protocol))].sort()
  }, [data.positions])

  const assetOptions = useMemo(() => {
    return [...new Set(data.positions.map(position => position.asset))].sort()
  }, [data.positions])

  const walletOptions = useMemo(() => {
    return data.wallets.map(wallet => ({
      value: wallet.walletAddr,
      label: wallet.walletLabel,
    }))
  }, [data.wallets])

  const filteredPositions = useMemo(() => {
    return data.positions.filter((position) => {
      if (protocolFilter && position.protocol !== protocolFilter) return false
      if (assetFilter && position.asset !== assetFilter) return false
      if (walletFilter && position.walletAddr !== walletFilter) return false
      if (search) {
        const needle = search.toLowerCase()
        if (
          !position.walletLabel.toLowerCase().includes(needle) &&
          !position.walletAddr.toLowerCase().includes(needle) &&
          !position.asset.toLowerCase().includes(needle) &&
          !position.protocol.toLowerCase().includes(needle) &&
          !position.entity.toLowerCase().includes(needle)
        ) return false
      }
      return true
    })
  }, [assetFilter, data.positions, protocolFilter, search, walletFilter])

  const filteredWalletKeys = useMemo(() => {
    return new Set(filteredPositions.map(position => position.walletAddr))
  }, [filteredPositions])

  function effectivePrincipalUsd(position: TreasuryManagementPosition) {
    return position.deployedPrincipalUsd ?? position.principalUsd
  }

  function principalSourceLabel(position: TreasuryManagementPosition) {
    switch (position.principalSource) {
      case 'deployed':
        return 'Deployed'
      case 'received':
        return 'Received'
      case 'mixed':
        return 'Mixed'
      default:
        return 'Unknown'
    }
  }

  const filteredSummary = useMemo(() => {
    const protocolCount = new Set(filteredPositions.map(position => position.protocol)).size
    const totalUsd = filteredPositions.reduce((sum, position) => sum + position.balanceUsd, 0)
    const principalUsd = filteredPositions.reduce((sum, position) => sum + effectivePrincipalUsd(position), 0)
    const yieldUsd = filteredPositions.reduce((sum, position) => sum + position.yieldUsd, 0)
    const walletsWithErrors = data.wallets.filter(
      wallet => filteredWalletKeys.has(wallet.walletAddr) && wallet.errors.length > 0
    ).length

    return {
      totalUsd,
      principalUsd,
      yieldUsd,
      walletCount: filteredWalletKeys.size,
      positionCount: filteredPositions.length,
      protocolCount,
      walletsWithErrors,
    }
  }, [data.wallets, filteredPositions, filteredWalletKeys])

  const hasClientFilters = !!(protocolFilter || assetFilter || walletFilter || search)
  const summary = hasClientFilters ? filteredSummary : data.summary
  const entityTabs = ['All', ...data.entities.map(item => item.entity)]
  const untrackedPositions = useMemo(
    () => filteredPositions.filter(position => !position.trackedPositionId),
    [filteredPositions],
  )

  const columns = [
    {
      key: 'walletLabel', label: 'Wallet', width: '220px',
      render: (position: TreasuryManagementPosition) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 600 }}>{position.walletLabel}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--muted)' }}>
            {fmtAddr(position.walletAddr, 6)}
          </span>
        </div>
      ),
    },
    {
      key: 'entity', label: 'Entity', width: '100px',
      render: (position: TreasuryManagementPosition) => (
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--muted)' }}>
          {position.entity}
        </span>
      ),
    },
    {
      key: 'platform', label: 'Platform', width: '110px',
      render: (position: TreasuryManagementPosition) => (
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.66rem', fontWeight: 700 }}>
          {position.platform}
        </span>
      ),
    },
    {
      key: 'principalSource', label: 'Source', width: '100px',
      render: (position: TreasuryManagementPosition) => (
        <span className="chain-tag">{principalSourceLabel(position)}</span>
      ),
    },
    {
      key: 'asset', label: 'Asset / Vault', width: '180px',
      render: (position: TreasuryManagementPosition) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>
            {position.vaultLabel || position.asset}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--muted)' }}>
            {position.asset}
          </span>
        </div>
      ),
    },
    {
      key: 'chain', label: 'Chain', width: '90px',
      render: (position: TreasuryManagementPosition) => (
        <span className="chain-tag">{position.chain}</span>
      ),
    },
    {
      key: 'totalBalance', label: 'Current Amount', numeric: true, width: '130px',
      render: (position: TreasuryManagementPosition) => fmtNum(position.totalBalance, 4),
    },
    {
      key: 'balanceUsd', label: 'Current USD', numeric: true, width: '120px',
      render: (position: TreasuryManagementPosition) => fmtUSD(position.balanceUsd),
    },
    {
      key: 'principalUsd', label: 'Principal USD', numeric: true, width: '120px',
      render: (position: TreasuryManagementPosition) => fmtUSD(effectivePrincipalUsd(position)),
    },
    {
      key: 'yieldUsd', label: 'Yield USD', numeric: true, width: '120px',
      render: (position: TreasuryManagementPosition) => (
        <span className={position.yieldUsd >= 0 ? 'gain-pos' : 'gain-neg'}>
          {position.yieldUsd >= 0 ? '+' : ''}{fmtUSD(position.yieldUsd)}
        </span>
      ),
    },
    {
      key: 'yieldPct', label: 'Yield %', numeric: true, width: '110px',
      render: (position: TreasuryManagementPosition) => (
        <span className={(position.yieldPct ?? 0) >= 0 ? 'gain-pos' : 'gain-neg'}>
          {position.yieldPct == null ? '—' : `${position.yieldPct >= 0 ? '+' : ''}${fmtNum(position.yieldPct, 2)}%`}
        </span>
      ),
    },
    {
      key: 'fundedUsd', label: 'Funded USD', numeric: true, width: '120px',
      render: (position: TreasuryManagementPosition) => (
        <span>{position.fundedUsd == null ? '—' : fmtUSD(position.fundedUsd)}</span>
      ),
    },
    {
      key: 'fundedAt', label: 'Funded Date', width: '110px',
      render: (position: TreasuryManagementPosition) => fmtDate(position.fundedAt),
    },
    {
      key: 'deployedAt', label: 'Principal Date', width: '110px',
      render: (position: TreasuryManagementPosition) => fmtDate(position.deployedAt),
    },
    {
      key: 'marketTvlUsd', label: 'TVL', numeric: true, width: '120px',
      render: (position: TreasuryManagementPosition) => (
        <span>{position.marketTvlUsd == null ? '—' : fmtUSD(position.marketTvlUsd)}</span>
      ),
    },
  ]

  return (
    <div>
      <div className="page-header">
        <div className="page-title">On-Chain Treasury Mgmt</div>
        <div className="page-sub">
          Protocol positions across treasury wallets
          {data.snapshotAt ? ` — snapshot ${fmtDateTime(data.snapshotAt)}` : ''}
        </div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {entityTabs.map(tab => (
            <button
              key={tab}
              className={`entity-tab${entity === tab ? ' active' : ''}`}
              onClick={() => setEntity(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="status-bar">
          <span className="status-dot loading" />
          <span className="status-text">Loading on-chain treasury positions…</span>
        </div>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : !data.hasSnapshot ? (
        <div className="section">
          <div
            style={{
              padding: 24,
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--panel2)',
              color: 'var(--muted)',
              fontSize: '0.82rem',
            }}
          >
            No on-chain treasury snapshot is cached yet. Once the producer writes
            {' '}
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>treasury-management/latest.json</span>
            {' '}
            to the data branch, positions will show here.
          </div>
        </div>
      ) : (
        <>
          <div className="cards-grid">
            <div className="card">
              <div className="card-label">Current Value</div>
              <div className="card-value">{fmtUSD(summary.totalUsd, 0)}</div>
              <div className="card-sub">{hasClientFilters ? 'Filtered view' : 'Full snapshot view'}</div>
            </div>
            <div className="card">
              <div className="card-label">Principal Basis</div>
              <div className="card-value">{fmtUSD(summary.principalUsd, 0)}</div>
              <div className="card-sub">{hasClientFilters ? 'Filtered view' : 'Full snapshot view'}</div>
            </div>
            <div className="card">
              <div className="card-label">Yield</div>
              <div className={`card-value ${summary.yieldUsd >= 0 ? 'green' : 'red'}`}>
                {summary.yieldUsd >= 0 ? '+' : ''}{fmtUSD(summary.yieldUsd, 0)}
              </div>
              <div className="card-sub">{hasClientFilters ? 'Filtered view' : 'Full snapshot view'}</div>
            </div>
            <div className="card">
              <div className="card-label">Wallets</div>
              <div className="card-value">{summary.walletCount.toLocaleString()}</div>
              <div className="card-sub">{summary.protocolCount.toLocaleString()} protocols</div>
            </div>
            <div className="card">
              <div className="card-label">Positions</div>
              <div className="card-value">{summary.positionCount.toLocaleString()}</div>
              <div className="card-sub">{summary.walletsWithErrors.toLocaleString()} wallets with errors</div>
            </div>
          </div>

          <div className="section">
            {untrackedPositions.length > 0 ? (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                  background: 'var(--panel2)',
                  color: 'var(--muted)',
                  fontSize: '0.75rem',
                }}
              >
                {untrackedPositions.length.toLocaleString()} position{untrackedPositions.length === 1 ? '' : 's'} in this view are not linked to the treasury ledger yet. Their current value is shown, but principal and yield may not fully align with the deployment records.
              </div>
            ) : null}
            <div className="section-header">
              <span className="section-title">{filteredPositions.length.toLocaleString()} positions</span>
              <div className="section-filters">
                <select className="fsel" value={protocolFilter} onChange={e => setProtocolFilter(e.target.value)}>
                  <option value="">All protocols</option>
                  {protocolOptions.map(protocol => (
                    <option key={protocol} value={protocol}>{protocol}</option>
                  ))}
                </select>
                <select className="fsel" value={assetFilter} onChange={e => setAssetFilter(e.target.value)}>
                  <option value="">All assets</option>
                  {assetOptions.map(asset => (
                    <option key={asset} value={asset}>{asset}</option>
                  ))}
                </select>
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>
                  {walletOptions.map(wallet => (
                    <option key={wallet.value} value={wallet.value}>{wallet.label}</option>
                  ))}
                </select>
                <input
                  className="fsearch"
                  placeholder="Wallet / protocol / asset…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <DataTable
              data={filteredPositions as unknown as Record<string, unknown>[]}
              columns={columns as never}
              defaultSort={{ col: 'balanceUsd', dir: 'desc' }}
              maxHeight="650px"
            />
          </div>
        </>
      )}
    </div>
  )
}
