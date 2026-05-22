'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { ENTITIES, ENTITY_COLORS } from '@/lib/constants'
import { fmtAddr } from '@/lib/format'
import { getWalletTypeLabel } from '@/lib/overview'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/skeleton'
import { CopyButton } from '@/components/copy-button'
import { useSharedAccess } from '@/lib/access-context'
import type { Wallet } from '@/lib/types'

type AdminEntity = { id: string; name: string; isActive: boolean }

type NewWalletForm = {
  chain: 'SOL' | 'ETH' | 'BTC'
  address: string
  label: string
  entityId: string
  accountCode: string
  isExternal: boolean
  overviewOnly: boolean
  includeInOverview: boolean
  backfill: boolean
}

const EMPTY_NEW_WALLET: NewWalletForm = {
  chain: 'SOL', address: '', label: '', entityId: '', accountCode: '',
  isExternal: false, overviewOnly: false, includeInOverview: true, backfill: true,
}

export default function WalletsPage() {
  const { access } = useSharedAccess()
  const isAdmin = access?.role === 'admin'

  const [walletRegistry, setWalletRegistry] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showExternal, setShowExternal] = useState(false)

  // Admin-only state
  const [entities, setEntities] = useState<AdminEntity[]>([])
  const [newWallet, setNewWallet] = useState<NewWalletForm>(EMPTY_NEW_WALLET)
  const [creatingWallet, setCreatingWallet] = useState(false)
  const [backfillingAddr, setBackfillingAddr] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

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

  // Admin: fetch entities (and admin wallet list for entity population)
  const refreshAdminEntities = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await fetch('/api/admin/wallets', { cache: 'no-store' })
      if (!res.ok) { setError(`Wallets: HTTP ${res.status}`); return }
      const data = await res.json() as { wallets: unknown[]; entities: AdminEntity[] }
      setEntities(data.entities)
      if (!newWallet.entityId && data.entities.length > 0) {
        setNewWallet((p) => ({ ...p, entityId: data.entities[0].id }))
      }
    } catch (err) { setError((err as Error).message) }
  }, [isAdmin, newWallet.entityId])

  useEffect(() => {
    if (isAdmin) refreshAdminEntities()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const createWallet = async () => {
    if (!newWallet.address.trim()) { setError('Address required'); return }
    if (!newWallet.label.trim()) { setError('Label required'); return }
    if (!newWallet.entityId) { setError('Entity required'); return }
    setCreatingWallet(true); setError(null)
    try {
      const res = await fetch('/api/admin/wallets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newWallet),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setNewWallet({ ...EMPTY_NEW_WALLET, entityId: newWallet.entityId })
      setFormOpen(false)
      // Re-fetch the public wallets list
      const listRes = await apiFetch<{ wallets: Wallet[] }>('/api/wallets')
      setWalletRegistry(listRes.wallets)
      const { mutate } = await import('swr')
      const { WALLETS_KEY } = await import('@/lib/hooks/use-entity-wallets')
      mutate(WALLETS_KEY)
    } catch (err) { setError((err as Error).message) }
    finally { setCreatingWallet(false) }
  }

  const backfillWallet = async (address: string) => {
    setBackfillingAddr(address); setError(null)
    try {
      const res = await fetch(`/api/admin/wallets/${encodeURIComponent(address)}/backfill`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // Re-fetch the public wallets list
      const listRes = await apiFetch<{ wallets: Wallet[] }>('/api/wallets')
      setWalletRegistry(listRes.wallets)
      const { mutate } = await import('swr')
      const { WALLETS_KEY } = await import('@/lib/hooks/use-entity-wallets')
      mutate(WALLETS_KEY)
    } catch (err) { setError((err as Error).message) }
    finally { setBackfillingAddr(null) }
  }

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
        {isAdmin && (
          <button
            className="btn-primary"
            onClick={() => setFormOpen((o) => !o)}
            style={{ marginLeft: 'auto', flexShrink: 0 }}
          >
            {formOpen ? 'Close' : 'Add wallet'}
          </button>
        )}
      </div>

      {/* Admin: collapsible Add Wallet form */}
      {isAdmin && formOpen && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-header">
            <div className="section-title">Add wallet</div>
            <div className="page-sub">Register a new wallet so it gets included in overview, transactions, and reporting.</div>
          </div>

          <div className="admin-access-form-grid">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="budget-scope-label">Chain</span>
              <select
                className="fsel"
                value={newWallet.chain}
                onChange={(e) => setNewWallet((p) => ({ ...p, chain: e.target.value as NewWalletForm['chain'] }))}
                disabled={creatingWallet}
              >
                <option value="SOL">Solana</option>
                <option value="ETH">Ethereum</option>
                <option value="BTC">Bitcoin</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="budget-scope-label">Entity</span>
              <select
                className="fsel"
                value={newWallet.entityId}
                onChange={(e) => setNewWallet((p) => ({ ...p, entityId: e.target.value }))}
                disabled={creatingWallet || entities.length === 0}
              >
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          </div>

          <div className="admin-access-form-grid">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' }}>
              <span className="budget-scope-label">Address</span>
              <input
                type="text"
                className="fsearch"
                placeholder={newWallet.chain === 'SOL' ? 'Base58 SOL pubkey' : newWallet.chain === 'ETH' ? '0x…' : 'bc1… / 1… / 3…'}
                value={newWallet.address}
                onChange={(e) => setNewWallet((p) => ({ ...p, address: e.target.value.trim() }))}
                disabled={creatingWallet}
              />
            </label>
          </div>

          <div className="admin-access-form-grid">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="budget-scope-label">Label</span>
              <input type="text" className="fsearch" placeholder="Treasury Cold" value={newWallet.label}
                onChange={(e) => setNewWallet((p) => ({ ...p, label: e.target.value }))} disabled={creatingWallet} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="budget-scope-label">Account code (optional)</span>
              <input type="text" className="fsearch" placeholder="e.g. 1010-OPCO" value={newWallet.accountCode}
                onChange={(e) => setNewWallet((p) => ({ ...p, accountCode: e.target.value }))} disabled={creatingWallet} />
            </label>
          </div>

          <div className="admin-access-restricted-section active" style={{ marginTop: 16 }}>
            <div className="section-title">Flags</div>
            <div className="admin-access-department-grid">
              <label className={`admin-access-department-pill${newWallet.isExternal ? ' selected' : ''}`}>
                <input type="checkbox" checked={newWallet.isExternal}
                  onChange={() => setNewWallet((p) => ({ ...p, isExternal: !p.isExternal }))} disabled={creatingWallet} />
                External counterparty
              </label>
              {newWallet.isExternal ? (
                <label className={`admin-access-department-pill${newWallet.overviewOnly ? ' selected' : ''}`}>
                  <input type="checkbox" checked={newWallet.overviewOnly}
                    onChange={() => setNewWallet((p) => ({ ...p, overviewOnly: !p.overviewOnly }))} disabled={creatingWallet} />
                  Show on overview anyway
                </label>
              ) : (
                <label className={`admin-access-department-pill${newWallet.includeInOverview ? ' selected' : ''}`}>
                  <input type="checkbox" checked={newWallet.includeInOverview}
                    onChange={() => setNewWallet((p) => ({ ...p, includeInOverview: !p.includeInOverview }))} disabled={creatingWallet} />
                  Show on overview
                </label>
              )}
            </div>
          </div>

          {(newWallet.chain === 'ETH' || newWallet.chain === 'BTC') && (
            <div className="admin-access-inline-warning" style={{ marginTop: 12 }}>
              Balance and transaction sync for {newWallet.chain} are not implemented yet — wallet record only.
              QB reporting via account code still works. On-chain balances will appear on overview once the chain integration ships.
            </div>
          )}

          {newWallet.chain === 'SOL' && !newWallet.isExternal && (
            <label className="admin-access-department-pill" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={newWallet.backfill}
                onChange={() => setNewWallet((p) => ({ ...p, backfill: !p.backfill }))} disabled={creatingWallet} />
              Backfill historical transactions (may take a few minutes)
            </label>
          )}

          <div className="admin-access-form-actions">
            <div className="admin-access-button-row">
              <button className="btn-primary" onClick={createWallet}
                disabled={creatingWallet || !newWallet.address.trim() || !newWallet.label.trim() || !newWallet.entityId}>
                {creatingWallet ? 'Adding…' : 'Add wallet'}
              </button>
              <button className="btn-secondary" onClick={() => { setNewWallet(EMPTY_NEW_WALLET); setFormOpen(false) }} disabled={creatingWallet}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div
          role="alert"
          className="error-msg"
          onClick={() => setError(null)}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            maxWidth: 380,
            zIndex: 1000,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          {error}
        </div>
      )}

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
              {isAdmin && <th></th>}
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
                    {isAdmin && <td></td>}
                  </tr>
                ))
              : filtered.map((w) => {
                  const c = ENTITY_COLORS[w.entity] || '#888'
                  const canBackfill = w.chain === 'SOL' && !w.isExternal
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
                      {isAdmin && (
                        <td>
                          {canBackfill && (
                            <button
                              className="btn-secondary"
                              onClick={() => backfillWallet(w.address)}
                              disabled={backfillingAddr === w.address}
                              style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                            >
                              {backfillingAddr === w.address ? 'Backfilling…' : 'Backfill'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
