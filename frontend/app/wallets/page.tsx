'use client'
import { useState, useMemo } from 'react'
import { ENTITIES, ENTITY_COLORS } from '@/lib/constants'
import { fmtAddr } from '@/lib/format'
import { getWalletTypeLabel } from '@/lib/overview'
import walletRegistry from '@/data/wallets.json'

type Wallet = typeof walletRegistry[number]

export default function WalletsPage() {
  const [entityFilter, setEntityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showExternal, setShowExternal] = useState(false)

  const filtered = useMemo(() => {
    return walletRegistry.filter((w: Wallet) => {
      if (entityFilter && w.entity !== entityFilter) return false
      if (!showExternal && w.isExternal) return false
      if (search) {
        const s = search.toLowerCase()
        if (!w.label.toLowerCase().includes(s) &&
            !w.address.toLowerCase().includes(s) &&
            !w.entity.toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [entityFilter, search, showExternal])

  const byEntity = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach((w: Wallet) => { map[w.entity] = (map[w.entity] || 0) + 1 })
    return map
  }, [filtered])

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Wallets</div>
        <div className="page-sub">{walletRegistry.length} wallets across {ENTITIES.length} entities</div>
      </div>

      {/* Filters */}
      <div className="controls-bar">
        <div className="entity-tabs">
          <button className={`entity-tab${entityFilter === '' ? ' active' : ''}`} onClick={() => setEntityFilter('')}>
            All ({filtered.length})
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
            {filtered.map((w: Wallet) => {
              const c = ENTITY_COLORS[w.entity] || '#888'
              return (
                <tr key={w.address}>
                  <td>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', fontWeight: 600, color: c }}>
                      {w.entity}
                    </span>
                  </td>
                  <td className="label">{w.label}</td>
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
