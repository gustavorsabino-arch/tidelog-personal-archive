'use client'
import { useEffect, useState, useMemo } from 'react'
import { ENTITIES, ENTITY_COLORS } from '@/lib/constants'
import { fmtAddr } from '@/lib/format'
import { getWalletTypeLabel } from '@/lib/overview'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/skeleton'
import { CopyButton } from '@/components/copy-button'
import type { Wallet } from '@/lib/types'

export default function WalletsPage() {
  const [walletRegistry, setWalletRegistry] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showExternal, setShowExternal] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch<{ wallets: Wallet[] }>('/api/wallets')
      .then((res) => { if (!cancelled) setWalletRegistry(res.wallets) })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load wallets')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Pre-filter applies everything EXCEPT the entity tab. Entity counts are
  // derived from this so switching tabs doesn't zero them out.
  const preEntityFiltered = useMemo(() => {
    return walletRegistry.filter((w) => {
      if (!showExternal && w.isExternal) return false
      if (search) {
        const s = search.toLowerCase()
        if (!w.label.toLowerCase().includes(s) &&
            !w.address.toLowerCase().includes(s) &&
            !w.entity.toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [walletRegistry, search, showExternal])

  const filtered = useMemo(() => {
    if (!entityFilter) return preEntityFiltered
    return preEntityFiltered.filter((w) => w.entity === entityFilter)
  }, [preEntityFiltered, entityFilter])

  const byEntity = useMemo(() => {
    const map: Record<string, number> = {}
    preEntityFiltered.forEach((w) => { map[w.entity] = (map[w.entity] || 0) + 1 })
    return map
  }, [preEntityFiltered])

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Wallets</div>
        <div className="page-sub">
          {loading ? 'Loading…' : error ? `Error: ${error}` : (() => {
            const entityCount = new Set(filtered.map((w) => w.entity)).size
            return `${filtered.length} wallet${filtered.length === 1 ? '' : 's'} across ${entityCount} entit${entityCount === 1 ? 'y' : 'ies'}`
          })()}
        </div>
      </div>

      {/* Filters */}
      <div className="controls-bar">
        <div className="entity-tabs">
          <button className={`entity-tab${entityFilter === '' ? ' active' : ''}`} onClick={() => setEntityFilter('')}>
            All ({preEntityFiltered.length})
          </button>
          {ENTITIES.map(e => (
            <button key={e} className={`entity-tab${entityFilter === e ? ' active' : ''}`} onClick={() => setEntityFilter(e)}>
              {e} ({byEntity[e] || 0})
            </button>
          ))}
        </div>
        <label style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showExternal} onChange={e => setShowExternal(e.target.checked)} />
          Show external
        </label>
        <input className="fsearch" placeholder="Search wallets…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className="table-wrap" style={{ maxHeight: '70vh', overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Label</th>
              <th>Address</th>
              <th>Chain</th>
              <th>Account Code</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    <td><Skeleton width={48} height={10} /></td>
                    <td><Skeleton width={120} height={10} /></td>
                    <td><Skeleton width={140} height={10} /></td>
                    <td><Skeleton width={56} height={14} /></td>
                    <td><Skeleton width={64} height={10} /></td>
                    <td><Skeleton width={72} height={10} /></td>
                  </tr>
                ))
              : filtered.map((w) => {
                  const c = ENTITY_COLORS[w.entity] || '#888'
                  return (
                    <tr key={w.address}>
                      <td>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', fontWeight: 600, color: c }}>
                          {w.entity}
                        </span>
                      </td>
                      <td className="label">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span title={w.label}>{w.label}</span>
                          <CopyButton address={w.address} />
                        </span>
                      </td>
                      <td>
                        <a href={`https://solscan.io/account/${w.address}`} target="_blank" rel="noreferrer"
                          style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', color: 'var(--accent)', textDecoration: 'none' }}
                          title={w.address}>
                          {fmtAddr(w.address, 6)}
                        </a>
                      </td>
                      <td><span className="chain-tag">{w.chain}</span></td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>
                        {w.accountCode || '—'}
                      </td>
                      <td style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                        {getWalletTypeLabel(w)}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
