'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { ENTITIES, ENTITY_COLORS } from '@/lib/constants'
import { fmtAddr } from '@/lib/format'
import { getWalletTypeLabel } from '@/lib/overview'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/skeleton'
import { CopyButton } from '@/components/copy-button'
import { useSharedAccess } from '@/lib/access-context'
import { hasPermission } from '@/lib/auth/permissions'
import type { Wallet } from '@/lib/types'
import { GlAccountCombobox } from '@/components/gl-account-combobox'
import { toDisplayEntity } from '@/lib/entity'
import { isQboEntity } from '@/lib/qb/config'

type AdminEntity = { id: string; name: string; isActive: boolean }

type NewWalletForm = {
  chain: 'SOL' | 'ETH' | 'BTC'
  address: string
  label: string
  entityId: string
  accountCode: string
  type: 'internal' | 'external'
  hiddenFromFinance: boolean
  backfill: boolean
}

const EMPTY_NEW_WALLET: NewWalletForm = {
  chain: 'SOL', address: '', label: '', entityId: '', accountCode: '',
  type: 'internal' as const, hiddenFromFinance: false, backfill: true,
}

export default function WalletsPage() {
  const { access } = useSharedAccess()
  const isAdmin = access?.role === 'admin'

  const [walletRegistry, setWalletRegistry] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [walletTypeFilter, setWalletTypeFilter] = useState<'internal' | 'external' | 'all'>('internal')
  // Wave 2c — only admin:manage_data roles can flip is_bulk_treasury. Other
  // viewers see the column read-only (disabled checkbox) so they can still
  // tell which wallets are bulk-mode.
  const canEdit = hasPermission(access?.role, 'admin:manage_data')
  // Per-address busy state during the optimistic flip → PATCH round-trip.
  const [bulkBusy, setBulkBusy] = useState<Record<string, boolean>>({})

  // Admin-only state
  const [entities, setEntities] = useState<AdminEntity[]>([])
  const [newWallet, setNewWallet] = useState<NewWalletForm>(EMPTY_NEW_WALLET)
  const [creatingWallet, setCreatingWallet] = useState(false)
  const [backfillingAddr, setBackfillingAddr] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ type: 'success' | 'info'; text: string } | null>(null)
  const [deletingAddr, setDeletingAddr] = useState<string | null>(null)
  const [deletingWallet, setDeletingWallet] = useState<Wallet | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [editingWallet, setEditingWallet] = useState<Wallet | null>(null)
  const [editForm, setEditForm] = useState<{
    label: string
    accountCode: string
    type: 'internal' | 'external'
    hiddenFromFinance: boolean
  }>({ label: '', accountCode: '', type: 'internal', hiddenFromFinance: false })
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  // Per-token GL state for the edit modal
  type TokenGlMapping = { tokenSymbol: string; accountCode: string }
  const [tokenGlMappings, setTokenGlMappings] = useState<TokenGlMapping[]>([])
  const [transactedTokens, setTransactedTokens] = useState<string[]>([])
  const [allTokens, setAllTokens] = useState<{ symbol: string; name: string }[]>([])
  const [tokenGlLoading, setTokenGlLoading] = useState(false)
  const [addTokenValue, setAddTokenValue] = useState('')

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
      if (walletTypeFilter === 'internal' && w.type !== 'internal') return false
      if (walletTypeFilter === 'external' && w.type !== 'external') return false
      if (search) {
        const s = search.toLowerCase()
        if (!w.label.toLowerCase().includes(s) &&
            !w.address.toLowerCase().includes(s) &&
            !w.entity.toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [walletRegistry, search, walletTypeFilter])

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

  const openDeleteModal = (w: Wallet) => {
    setDeletingWallet(w)
    setConfirmText('')
  }

  const closeDeleteModal = () => {
    setDeletingWallet(null)
    setConfirmText('')
  }

  const executeDelete = async () => {
    if (!deletingWallet) return
    if (confirmText !== deletingWallet.label) {
      setError(`The label you typed doesn't match. Type "${deletingWallet.label}" exactly to confirm.`)
      return
    }
    const w = deletingWallet
    setDeletingAddr(w.address); setError(null)
    try {
      const res = await fetch(`/api/admin/wallets/${encodeURIComponent(w.address)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // Refresh list
      const refreshed = await apiFetch<{ wallets: Wallet[] }>('/api/wallets')
      setWalletRegistry(refreshed.wallets)
      const { mutate } = await import('swr')
      const { WALLETS_KEY } = await import('@/lib/hooks/use-entity-wallets')
      mutate(WALLETS_KEY)
      closeDeleteModal()
    } catch (err) { setError((err as Error).message) }
    finally { setDeletingAddr(null) }
  }

  const openEditModal = (w: Wallet) => {
    setEditingWallet(w)
    setEditForm({
      label: w.label,
      accountCode: w.accountCode ?? '',
      type: w.type,
      hiddenFromFinance: w.hiddenFromFinance,
    })
    setEditError(null)
    setError(null)
    // Reset per-token GL state
    setTokenGlMappings([])
    setTransactedTokens([])
    setAllTokens([])
    setAddTokenValue('')
    if (isQboEntity(w.entity)) {
      setTokenGlLoading(true)
      Promise.all([
        apiFetch<{ mappings: { tokenSymbol: string; accountCode: string }[]; transactedTokens: string[] }>(
          `/api/wallets/${encodeURIComponent(w.address)}/token-gl`
        ),
        apiFetch<{ tokens: { symbol: string; name: string }[] }>('/api/tokens'),
      ])
        .then(([glRes, tokensRes]) => {
          setTokenGlMappings(glRes.mappings)
          setTransactedTokens(glRes.transactedTokens)
          setAllTokens(tokensRes.tokens)
        })
        .catch(() => { /* silently ignore — GL rows are optional */ })
        .finally(() => setTokenGlLoading(false))
    }
  }

  const closeEditModal = () => {
    setEditingWallet(null)
    setEditError(null)
    setSavingEdit(false)
    setTokenGlMappings([])
    setTransactedTokens([])
    setAllTokens([])
    setAddTokenValue('')
  }

  const saveEdit = async () => {
    if (!editingWallet) return
    const trimmedLabel = editForm.label.trim()
    if (!trimmedLabel) { setEditError('Label is required.'); return }
    if (trimmedLabel.length > 80) { setEditError('Label must be 80 characters or fewer.'); return }

    // Build patch body — only include fields that actually changed, to keep
    // the audit trail clean (no-op edits don't show up).
    const patch: Record<string, unknown> = {}
    if (trimmedLabel !== editingWallet.label) patch.label = trimmedLabel
    const newAccountCode = editForm.accountCode.trim() === '' ? null : editForm.accountCode.trim()
    const oldAccountCode = editingWallet.accountCode ?? null
    if (newAccountCode !== oldAccountCode) patch.accountCode = newAccountCode
    if (editForm.type !== editingWallet.type) patch.type = editForm.type
    if (editForm.hiddenFromFinance !== editingWallet.hiddenFromFinance) patch.hiddenFromFinance = editForm.hiddenFromFinance

    if (Object.keys(patch).length === 0) {
      closeEditModal()
      return
    }

    const becameInternal = editingWallet.type === 'external' && editForm.type === 'internal'
    const becameUnhidden = editingWallet.hiddenFromFinance === true && editForm.hiddenFromFinance === false
    if (becameInternal || becameUnhidden) {
      const ok = window.confirm(
        `This wallet now needs a full balance + transaction backfill to populate historical data.\n\nSave the change anyway? The "Needs backfill" pill will appear on this wallet's row, and you can run the backfill from there.`
      )
      if (!ok) return
    }

    setSavingEdit(true); setEditError(null)
    try {
      const res = await fetch(`/api/wallets/${encodeURIComponent(editingWallet.address)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const refreshed = await apiFetch<{ wallets: Wallet[] }>('/api/wallets')
      setWalletRegistry(refreshed.wallets)
      const { mutate } = await import('swr')
      const { WALLETS_KEY } = await import('@/lib/hooks/use-entity-wallets')
      mutate(WALLETS_KEY)
      closeEditModal()
    } catch (err) {
      setEditError((err as Error).message)
      setSavingEdit(false)
    }
  }

  const backfillWallet = async (address: string) => {
    setBackfillingAddr(address); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/admin/wallets/${encodeURIComponent(address)}/backfill`, { method: 'POST' })
      if (res.status === 504) {
        setNotice({ type: 'info', text: 'Backfill paused — click Backfill again to resume from where it left off.' })
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json() as { ok?: boolean; inserted?: number; mode?: string; elapsedMs?: number }
      const inserted = body.inserted ?? 0
      const mode = body.mode ?? 'full'
      const sec = body.elapsedMs != null ? Math.max(1, Math.round(body.elapsedMs / 1000)) : null
      setNotice({
        type: 'success',
        text: `Backfill complete (${mode}): ${inserted} transaction${inserted === 1 ? '' : 's'} inserted${sec ? ` in ${sec}s` : ''}.`,
      })
      // Re-fetch the public wallets list
      const listRes = await apiFetch<{ wallets: Wallet[] }>('/api/wallets')
      setWalletRegistry(listRes.wallets)
      const { mutate } = await import('swr')
      const { WALLETS_KEY } = await import('@/lib/hooks/use-entity-wallets')
      mutate(WALLETS_KEY)
    } catch (err) {
      const msg = (err as Error).message
      // Network abort / timeout from client side (Vercel cuts the connection at 300s)
      if (msg.includes('aborted') || msg.includes('Failed to fetch') || msg.includes('timeout')) {
        setNotice({ type: 'info', text: 'Backfill paused — click Backfill again to resume from where it left off.' })
      } else {
        setError(msg)
      }
    }
    finally { setBackfillingAddr(null) }
  }

  // Optimistic toggle: flip in local state, fire the PATCH, revert on failure.
  // Avoids a full refetch — the rest of the page state is unaffected.
  async function toggleBulkTreasury(address: string, next: boolean) {
    if (!canEdit) return
    setBulkBusy(s => ({ ...s, [address]: true }))
    setWalletRegistry(rs => rs.map(w => w.address === address ? { ...w, isBulkTreasury: next } : w))
    try {
      await apiFetch(`/api/wallets/${address}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isBulkTreasury: next }),
      })
    } catch (err) {
      // Revert on failure and surface to error banner
      setWalletRegistry(rs => rs.map(w => w.address === address ? { ...w, isBulkTreasury: !next } : w))
      setError(err instanceof Error ? err.message : 'Failed to update wallet')
    } finally {
      setBulkBusy(s => {
        const { [address]: _, ...rest } = s
        return rest
      })
    }
  }

  const BULK_TOOLTIP = 'When enabled, transactions on this wallet are aggregated by token + month into a single QuickBooks journal entry instead of posted individually.'

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Wallets</div>
        <div className="page-sub">
          {loading ? 'Loading…' : error ? `Error: ${error}` : (() => {
            const entityCount = new Set(filtered.map((w) => w.entity)).size
            const typeLabel = walletTypeFilter === 'all' ? '' : ` ${walletTypeFilter}`
            return `${filtered.length}${typeLabel} wallet${filtered.length === 1 ? '' : 's'} across ${entityCount} entit${entityCount === 1 ? 'y' : 'ies'}`
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
        <div className="entity-tabs" role="group" aria-label="Wallet type filter">
          {(['internal', 'external', 'all'] as const).map((t) => (
            <button
              key={t}
              className={`entity-tab${walletTypeFilter === t ? ' active' : ''}`}
              onClick={() => setWalletTypeFilter(t)}
              aria-pressed={walletTypeFilter === t}
            >
              {t === 'all' ? 'All' : t === 'internal' ? 'Internal' : 'External'}
            </button>
          ))}
        </div>
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
              {isQboEntity(toDisplayEntity(newWallet.entityId)) ? (
                <>
                  <GlAccountCombobox
                    value={newWallet.accountCode || null}
                    entity={toDisplayEntity(newWallet.entityId)}
                    onChange={(v) => setNewWallet((p) => ({ ...p, accountCode: v ?? '' }))}
                    disabled={creatingWallet}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Add per-token GL after creating the wallet.</span>
                </>
              ) : (
                <input type="text" className="fsearch" placeholder="e.g. 1010-OPCO" value={newWallet.accountCode}
                  onChange={(e) => setNewWallet((p) => ({ ...p, accountCode: e.target.value }))} disabled={creatingWallet} />
              )}
            </label>
          </div>

          <div className="admin-access-restricted-section active" style={{ marginTop: 16 }}>
            <div className="section-title">Flags</div>
            <div className="admin-access-department-grid">
              <label className={`admin-access-department-pill${newWallet.type === 'internal' ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="new-wallet-type"
                  checked={newWallet.type === 'internal'}
                  onChange={() => setNewWallet((p) => ({ ...p, type: 'internal' }))}
                  disabled={creatingWallet}
                />
                Internal
              </label>
              <label className={`admin-access-department-pill${newWallet.type === 'external' ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="new-wallet-type"
                  checked={newWallet.type === 'external'}
                  onChange={() => setNewWallet((p) => ({ ...p, type: 'external', hiddenFromFinance: false }))}
                  disabled={creatingWallet}
                />
                External
              </label>
              {newWallet.type === 'internal' && (
                <label className={`admin-access-department-pill${newWallet.hiddenFromFinance ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={newWallet.hiddenFromFinance}
                    onChange={() => setNewWallet((p) => ({ ...p, hiddenFromFinance: !p.hiddenFromFinance }))}
                    disabled={creatingWallet}
                  />
                  Hidden from finance
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

          {newWallet.chain === 'SOL' && newWallet.type === 'internal' && !newWallet.hiddenFromFinance && (
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

      {/* Success / info notice */}
      {notice && (
        <div
          role="status"
          onClick={() => setNotice(null)}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            maxWidth: 420,
            zIndex: 1000,
            cursor: 'pointer',
            padding: '12px 16px',
            borderRadius: 8,
            fontSize: '0.85rem',
            lineHeight: 1.4,
            background: notice.type === 'success' ? 'color-mix(in srgb, var(--green, #10b981) 12%, var(--surface, #fff))' : 'color-mix(in srgb, var(--accent, #2563eb) 12%, var(--surface, #fff))',
            border: `1px solid ${notice.type === 'success' ? 'var(--green, #10b981)' : 'var(--accent, #2563eb)'}`,
            color: 'var(--fg, #1f2937)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          {notice.text}
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
              <th title={BULK_TOOLTIP}>Bulk Treasury</th>
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
                    <td><Skeleton width={20} height={14} /></td>
                    {isAdmin && <td></td>}
                  </tr>
                ))
              : filtered.map((w) => {
                  const c = ENTITY_COLORS[w.entity] || '#888'
                  const showBackfillButton = w.chain === 'SOL' && w.type === 'internal' && !w.hiddenFromFinance && w.needsBackfill
                  const tintExternal = walletTypeFilter === 'all' && w.type === 'external'
                  return (
                    <tr
                      key={w.address}
                      style={tintExternal ? { background: 'color-mix(in srgb, var(--muted) 6%, transparent)' } : undefined}
                    >
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
                        {w.needsBackfill && (
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            marginLeft: 8,
                            borderRadius: 999,
                            background: 'color-mix(in srgb, #d97706 12%, transparent)',
                            color: '#d97706',
                            fontSize: '0.65rem',
                            fontFamily: 'var(--mono)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}>
                            ⚠ Needs backfill
                          </span>
                        )}
                        {w.hiddenFromFinance && (
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            marginLeft: 8,
                            borderRadius: 999,
                            background: 'var(--surface)',
                            color: 'var(--muted)',
                            fontSize: '0.65rem',
                            fontFamily: 'var(--mono)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            border: '1px solid var(--border)',
                          }}>
                            🔒 Hidden
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!!w.isBulkTreasury}
                          disabled={!canEdit || !!bulkBusy[w.address]}
                          onChange={(e) => toggleBulkTreasury(w.address, e.target.checked)}
                          title={!canEdit
                            ? 'Your role does not have admin:manage_data permission'
                            : BULK_TOOLTIP}
                          style={{ cursor: canEdit ? 'pointer' : 'not-allowed' }}
                        />
                      </td>
                      {isAdmin && (
                        <td>
                          <button
                            className="btn-secondary"
                            style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                            onClick={() => openEditModal(w)}
                          >
                            Edit
                          </button>
                          {showBackfillButton && (
                            <button
                              className="btn-secondary"
                              onClick={() => backfillWallet(w.address)}
                              disabled={backfillingAddr === w.address}
                              style={{ fontSize: '0.7rem', padding: '2px 8px', marginLeft: 6 }}
                            >
                              {backfillingAddr === w.address ? 'Backfilling…' : 'Run backfill'}
                            </button>
                          )}
                          <button
                            className="btn-secondary"
                            style={{ fontSize: '0.7rem', padding: '4px 6px', marginLeft: 6, color: 'var(--red)', borderColor: 'color-mix(in srgb, var(--red) 28%, var(--border))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => openDeleteModal(w)}
                            disabled={deletingAddr === w.address}
                            aria-label="Delete wallet"
                            title={deletingAddr === w.address ? 'Deleting…' : 'Delete wallet'}
                          >
                            {deletingAddr === w.address ? (
                              <span style={{ fontSize: '0.7rem' }}>…</span>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              </svg>
                            )}
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation modal */}
      {deletingWallet && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) closeDeleteModal() }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 24,
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 520, width: '100%', padding: 24, background: 'var(--bg, #fff)' }}
          >
            <div style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 14, color: 'var(--red)' }}>
              Delete wallet &ldquo;{deletingWallet.label}&rdquo;?
            </div>

            <div style={{ fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 14 }}>
              This will permanently remove:
              <ul style={{ margin: '8px 0 8px 20px', padding: 0, fontWeight: 600 }}>
                <li>The wallet record</li>
                <li>All of its transactions</li>
                <li>All of its balance snapshots</li>
              </ul>
              Gains for entity <strong>{deletingWallet.entity}</strong>{' '}will be recomputed without this wallet&rsquo;s contributions.
            </div>

            <div className="admin-access-inline-warning" style={{ marginBottom: 12, color: 'var(--fg, #1f2937)', lineHeight: 1.5 }}>
              The wallet will no longer appear on Overview, Treasury Management, Transactions, or any other page.
              The audit trail (created / backfilled / deleted events) is preserved for compliance.
            </div>

            <div style={{ marginBottom: 18, color: 'var(--red)', fontWeight: 700, fontSize: '0.95rem' }}>
              This cannot be undone.
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
              <span className="budget-scope-label">
                Type the wallet label to confirm: <code style={{ background: 'var(--surface, #f4f4f5)', padding: '2px 6px', borderRadius: 4 }}>{deletingWallet.label}</code>
              </span>
              <input
                type="text"
                className="fsearch"
                autoFocus
                value={confirmText}
                onChange={(e) => { setConfirmText(e.target.value); if (error) setError(null) }}
                placeholder={deletingWallet.label}
                disabled={deletingAddr === deletingWallet.address}
              />
            </label>
            {error && deletingWallet && error.includes("doesn't match") && (
              <div style={{ marginTop: 6, color: 'var(--red)', fontSize: '0.8rem' }}>
                {error}
              </div>
            )}

            <div className="admin-access-button-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                className="btn-secondary"
                onClick={closeDeleteModal}
                disabled={deletingAddr === deletingWallet.address}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={executeDelete}
                disabled={deletingAddr === deletingWallet.address}
              >
                {deletingAddr === deletingWallet.address ? 'Deleting…' : 'Delete wallet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit wallet modal — label + accountCode */}
      {editingWallet && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget && !savingEdit) closeEditModal() }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 24,
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 480, width: '100%', padding: 24, background: 'var(--bg, #fff)' }}
          >
            <div style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 12 }}>
              Edit wallet
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 16, fontFamily: 'var(--mono)' }}>
              {editingWallet.address}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              <span className="budget-scope-label">Label</span>
              <input
                type="text"
                className="fsearch"
                autoFocus
                value={editForm.label}
                onChange={(e) => { setEditForm((p) => ({ ...p, label: e.target.value })); if (editError) setEditError(null) }}
                disabled={savingEdit}
                maxLength={80}
                placeholder="e.g. Treasury Cold"
                style={!editForm.label.trim() ? { borderColor: 'var(--red)' } : undefined}
              />
            </label>

            {editingWallet && isQboEntity(editingWallet.entity) && (
              <div style={{ marginBottom: 18 }}>
                {/* Default GL */}
                <div style={{ marginBottom: 12 }}>
                  <span className="budget-scope-label" style={{ display: 'block', marginBottom: 6 }}>
                    Default GL <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(used for any token without its own mapping)</span>
                  </span>
                  <GlAccountCombobox
                    value={editForm.accountCode || null}
                    entity={editingWallet.entity}
                    onChange={(v) => { setEditForm(p => ({ ...p, accountCode: v ?? '' })); if (editError) setEditError(null) }}
                    disabled={savingEdit}
                  />
                </div>

                {/* Per-token GL rows */}
                {tokenGlLoading ? (
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 8 }}>Loading token mappings…</div>
                ) : (() => {
                  // Union of transacted tokens and mapped tokens, deduplicated — these are the rows shown
                  const mappedSymbols = tokenGlMappings.map(m => m.tokenSymbol)
                  const shownTokens = Array.from(new Set([...mappedSymbols, ...transactedTokens])).sort()
                  const mappingByToken = new Map(tokenGlMappings.map(m => [m.tokenSymbol, m.accountCode]))

                  const handleTokenGlChange = async (tokenSymbol: string, v: string | null) => {
                    const addr = editingWallet.address
                    if (v) {
                      await apiFetch(`/api/wallets/${encodeURIComponent(addr)}/token-gl`, {
                        method: 'PUT',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ tokenSymbol, accountCode: v }),
                      })
                      setTokenGlMappings(prev => {
                        const next = prev.filter(m => m.tokenSymbol !== tokenSymbol)
                        next.push({ tokenSymbol, accountCode: v })
                        return next
                      })
                    } else {
                      await apiFetch(`/api/wallets/${encodeURIComponent(addr)}/token-gl`, {
                        method: 'DELETE',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ tokenSymbol }),
                      })
                      setTokenGlMappings(prev => prev.filter(m => m.tokenSymbol !== tokenSymbol))
                    }
                  }

                  // Tokens available to add — full token list minus those already shown as rows
                  const availableToAdd = allTokens
                    .map(t => t.symbol)
                    .filter(s => !shownTokens.includes(s))

                  return (
                    <>
                      {shownTokens.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <span className="budget-scope-label" style={{ display: 'block', marginBottom: 6 }}>
                            Per-token GL overrides
                          </span>
                          {shownTokens.map(tokenSymbol => {
                            const mapped = mappingByToken.get(tokenSymbol) ?? null
                            return (
                              <div key={tokenSymbol} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', minWidth: 64, flexShrink: 0 }}>{tokenSymbol}</span>
                                <div style={{ flex: 1 }}>
                                  <GlAccountCombobox
                                    value={mapped}
                                    entity={editingWallet.entity}
                                    onChange={(v) => handleTokenGlChange(tokenSymbol, v)}
                                    disabled={savingEdit}
                                  />
                                </div>
                                {!mapped && (
                                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>using default</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Add token row */}
                      {availableToAdd.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <select
                            className="fsel"
                            value={addTokenValue}
                            onChange={(e) => setAddTokenValue(e.target.value)}
                            disabled={savingEdit}
                            style={{ fontSize: '0.78rem' }}
                          >
                            <option value="">＋ Add token…</option>
                            {availableToAdd.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          {addTokenValue && (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                              onClick={() => {
                                if (!addTokenValue) return
                                // Add to transacted list so it shows as a row
                                setTransactedTokens(prev => Array.from(new Set([...prev, addTokenValue])))
                                setAddTokenValue('')
                              }}
                              disabled={savingEdit}
                            >
                              Add
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <span className="budget-scope-label" style={{ display: 'block', marginBottom: 6 }}>Type</span>
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="edit-wallet-type"
                    checked={editForm.type === 'internal'}
                    onChange={() => setEditForm(p => ({ ...p, type: 'internal' }))}
                    disabled={savingEdit}
                  />
                  Internal
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="edit-wallet-type"
                    checked={editForm.type === 'external'}
                    onChange={() => setEditForm(p => ({ ...p, type: 'external', hiddenFromFinance: false }))}
                    disabled={savingEdit}
                  />
                  External
                </label>
              </div>
            </div>
            {editForm.type === 'internal' && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={editForm.hiddenFromFinance}
                    onChange={(e) => setEditForm(p => ({ ...p, hiddenFromFinance: e.target.checked }))}
                    disabled={savingEdit}
                  />
                  Hidden from finance views
                </label>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>
                  Wallet stays in counterparty lookup but is excluded from overview, G&amp;L, P&amp;L, FIFO, and ledger.
                </div>
              </div>
            )}

            {(() => {
              // Runtime errors (API failures) take precedence; otherwise derive
              // a validation message from form state so the user sees WHY Save
              // is disabled without having to click first.
              const displayError = editError ?? (!editForm.label.trim() ? 'Label is required.' : null)
              if (!displayError) return null
              return (
                <div
                  role="alert"
                  style={{
                    marginBottom: 12,
                    padding: '6px 10px',
                    background: 'color-mix(in srgb, var(--red) 8%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--red) 25%, transparent)',
                    borderRadius: 4,
                    color: 'var(--red)',
                    fontSize: '0.78rem',
                    lineHeight: 1.4,
                  }}
                >
                  {displayError}
                </div>
              )
            })()}

            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 18, lineHeight: 1.4 }}>
              Changes apply immediately and are non-destructive — historical transactions and gains are unaffected. The Balance Sheet on-chain summary regroups this wallet under the new GL bucket on next page load.
            </div>

            <div className="admin-access-button-row" style={{ justifyContent: 'flex-end' }}>
              <button
                className="btn-secondary"
                onClick={closeEditModal}
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={saveEdit}
                disabled={savingEdit || !editForm.label.trim()}
                style={(savingEdit || !editForm.label.trim()) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                title={!editForm.label.trim() ? 'Label is required' : undefined}
              >
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
