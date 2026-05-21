'use client'

import { useEffect, useMemo, useState } from 'react'
import { BUDGET_DEPTS } from '@/lib/constants'
import { useSharedAccess } from '@/lib/access-context'
import { Skeleton } from '@/components/skeleton'

type AdminUser = {
  id: string
  name: string
  email: string
  emails: string[]
  role: 'admin' | 'budget_viewer' | null
  departments: string[]
  banned: boolean
  createdAt: string
}

type Draft = {
  role: 'admin' | 'budget_viewer' | '' | null
  departments: string[]
  linkEmail: string
}

type NewUserForm = {
  email: string
  role: 'admin' | 'budget_viewer'
  departments: string[]
}

const EMPTY_NEW_USER: NewUserForm = { email: '', role: 'budget_viewer', departments: [] }

type AdminWallet = {
  address: string
  label: string
  chain: 'SOL' | 'ETH' | 'BTC'
  entityId: string
  accountCode: string | null
  isExternal: boolean
  overviewOnly: boolean
  includeInOverview: boolean
  createdAt: string
}

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

function emptyDraft(user: AdminUser): Draft {
  return {
    role: user.role ?? '',
    departments: [...user.departments],
    linkEmail: '',
  }
}

export default function AdminPage() {
  const { access } = useSharedAccess()
  const myEmail = access?.email ?? null
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!error) return
    const id = window.setTimeout(() => setError(null), 4000)
    return () => window.clearTimeout(id)
  }, [error])

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newUser, setNewUser] = useState<NewUserForm>(EMPTY_NEW_USER)
  const [creating, setCreating] = useState(false)

  const [wallets, setWallets] = useState<AdminWallet[] | null>(null)
  const [entities, setEntities] = useState<AdminEntity[]>([])
  const [newWallet, setNewWallet] = useState<NewWalletForm>(EMPTY_NEW_WALLET)
  const [creatingWallet, setCreatingWallet] = useState(false)
  const [backfillingAddr, setBackfillingAddr] = useState<string | null>(null)

  const refreshWallets = async () => {
    try {
      const res = await fetch('/api/admin/wallets', { cache: 'no-store' })
      if (!res.ok) { setError(`Wallets: HTTP ${res.status}`); return }
      const data = await res.json() as { wallets: AdminWallet[]; entities: AdminEntity[] }
      setWallets(data.wallets)
      setEntities(data.entities)
      if (!newWallet.entityId && data.entities.length > 0) {
        setNewWallet((p) => ({ ...p, entityId: data.entities[0].id }))
      }
    } catch (err) { setError((err as Error).message) }
  }

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { users: AdminUser[] }
      setUsers(data.users)
      const draftsNext: Record<string, Draft> = {}
      for (const u of data.users) draftsNext[u.id] = emptyDraft(u)
      setDrafts(draftsNext)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh(); refreshWallets() }, [])

  const sortedUsers = useMemo(() => {
    if (!users) return []
    return [...users].sort((a, b) => a.email.localeCompare(b.email))
  }, [users])

  const setDraft = (id: string, next: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }))
  }

  const applyPatch = async (id: string, body: Record<string, unknown>) => {
    setSavingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `HTTP ${res.status}`)
      }
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSavingId(null)
    }
  }

  const saveDraft = (user: AdminUser) => {
    const d = drafts[user.id]
    if (!d) return
    const patch: Record<string, unknown> = {}
    const roleNormalized = d.role === '' ? null : d.role
    if (roleNormalized !== user.role) patch.role = roleNormalized
    if (JSON.stringify([...d.departments].sort()) !== JSON.stringify([...user.departments].sort())) {
      patch.departments = d.departments
    }
    if (Object.keys(patch).length === 0) return
    applyPatch(user.id, patch)
  }

  const deleteUser = async (u: AdminUser) => {
    if (!window.confirm(`Remove ${u.email}? This cannot be undone.`)) return
    setSavingId(u.id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `HTTP ${res.status}`)
      }
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSavingId(null)
    }
  }

  const linkEmail = (user: AdminUser) => {
    const d = drafts[user.id]
    const email = d?.linkEmail.trim().toLowerCase()
    if (!email) return
    applyPatch(user.id, { linkEmail: email })
    setDraft(user.id, { linkEmail: '' })
  }

  const unlinkEmail = (user: AdminUser, email: string) => {
    if (email === user.email) {
      setError('Cannot unlink the primary email.')
      return
    }
    applyPatch(user.id, { unlinkEmail: email })
  }

  const toggleDepartment = (id: string, dept: string) => {
    const d = drafts[id]
    if (!d) return
    const next = d.departments.includes(dept)
      ? d.departments.filter((x) => x !== dept)
      : [...d.departments, dept]
    setDraft(id, { departments: next })
  }

  const toggleNewUserDepartment = (dept: string) => {
    setNewUser((prev) => ({
      ...prev,
      departments: prev.departments.includes(dept)
        ? prev.departments.filter((x) => x !== dept)
        : [...prev.departments, dept],
    }))
  }

  const createUser = async () => {
    const email = newUser.email.trim().toLowerCase()
    if (!email) {
      setError('Email is required.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { email }
      if (newUser.role) body.role = newUser.role
      if (newUser.role === 'budget_viewer' && newUser.departments.length > 0) {
        body.departments = newUser.departments
      }
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `HTTP ${res.status}`)
      }
      setNewUser(EMPTY_NEW_USER)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

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
      await refreshWallets()
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
      await refreshWallets()
      const { mutate } = await import('swr')
      const { WALLETS_KEY } = await import('@/lib/hooks/use-entity-wallets')
      mutate(WALLETS_KEY)
    } catch (err) { setError((err as Error).message) }
    finally { setBackfillingAddr(null) }
  }

  if (loading) {
    return (
      <main className="admin-access-page">
        <header className="admin-access-header">
          <div>
            <div className="page-title">User Management</div>
            <div className="page-sub">
              Pre-approve emails and assign roles. This list controls who can access the app.
            </div>
          </div>
        </header>
        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Departments</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  <td><Skeleton width={180} height={10} /></td>
                  <td><Skeleton width={70} height={10} /></td>
                  <td><Skeleton width={140} height={10} /></td>
                  <td><Skeleton width={56} height={10} /></td>
                  <td><Skeleton width={90} height={10} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    )
  }

  return (
    <main className="admin-access-page">
      <header className="admin-access-header">
        <div>
          <div className="page-title">User Management</div>
          <div className="page-sub">
            Pre-approve emails and assign roles. This list controls who can access the app.
          </div>
        </div>
        <div className="admin-access-header-actions">
          <button className="btn-secondary" onClick={refresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

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
            animation: 'admin-toast-in 0.2s ease-out',
          }}
        >
          {error}
        </div>
      )}

      <section className="card admin-access-settings-card">
        <div className="section-header">
          <div className="section-title">Add user</div>
          <div className="page-sub">
            Grant access to a new user by pre-approving their email.
          </div>
        </div>

        <div className="admin-access-form-grid">
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="budget-scope-label">Email</span>
            <input
              type="email"
              className="fsearch admin-access-email-input"
              placeholder="person@orca.so"
              value={newUser.email}
              onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
              disabled={creating}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="budget-scope-label">Role</span>
            <select
              className="fsel"
              value={newUser.role}
              onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value as NewUserForm['role'] }))}
              disabled={creating}
            >
              <option value="budget_viewer">Budget Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>

        {newUser.role === 'budget_viewer' && (
          <div className="admin-access-restricted-section active">
            <div className="section-title">Departments</div>
            <div className="admin-access-department-grid">
              {BUDGET_DEPTS.map((dept) => {
                const selected = newUser.departments.includes(dept)
                return (
                  <label
                    key={dept}
                    className={`admin-access-department-pill${selected ? ' selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleNewUserDepartment(dept)}
                      disabled={creating}
                    />
                    {dept}
                  </label>
                )
              })}
            </div>
          </div>
        )}

        <div className="admin-access-form-actions">
          <div className="admin-access-button-row">
            <button
              className="btn-primary"
              onClick={createUser}
              disabled={creating || !newUser.email.trim()}
            >
              {creating ? 'Adding…' : 'Add user'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setNewUser(EMPTY_NEW_USER)}
              disabled={creating}
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      {sortedUsers.length === 0 ? (
        <div className="empty admin-access-empty">
          <div className="empty-icon">∅</div>
          <div>No users yet. Add a user above to grant access.</div>
        </div>
      ) : (
        <div className="admin-access-list">
          {sortedUsers.map((u) => {
            const d = drafts[u.id] ?? emptyDraft(u)
            const isViewer = d.role === 'budget_viewer'
            const isSaving = savingId === u.id
            const isMe = myEmail !== null && u.emails.some((e) => e.toLowerCase() === myEmail.toLowerCase())
            const dirty =
              (d.role === '' ? null : d.role) !== u.role ||
              JSON.stringify([...d.departments].sort()) !== JSON.stringify([...u.departments].sort())

            return (
              <article
                key={u.id}
                className={`admin-access-list-item${dirty ? ' active' : ''}`}
                style={{ cursor: 'default' }}
              >
                <div className="admin-access-list-head">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <strong>
                      {u.email}
                      {isMe && <span style={{ marginLeft: 8, color: 'var(--accent)', fontSize: '0.68rem' }}>you</span>}
                    </strong>
                    {u.emails.length > 1 && (
                      <div className="admin-access-list-meta">{u.emails.length} linked emails</div>
                    )}
                  </div>
                  <select
                    className="fsel"
                    value={d.role ?? ''}
                    onChange={(e) => setDraft(u.id, { role: e.target.value as Draft['role'] })}
                    disabled={isSaving || isMe}
                    title={isMe ? 'Cannot change your own role' : undefined}
                    style={{ minWidth: 160 }}
                  >
                    <option value="" disabled hidden>Pending</option>
                    <option value="budget_viewer">Budget Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                {isViewer && (
                  <div className={`admin-access-restricted-section${isViewer ? ' active' : ''}`}>
                    <div className="section-title">Departments</div>
                    <div className="admin-access-department-grid">
                      {BUDGET_DEPTS.map((dept) => {
                        const selected = d.departments.includes(dept)
                        return (
                          <label
                            key={dept}
                            className={`admin-access-department-pill${selected ? ' selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleDepartment(u.id, dept)}
                              disabled={isSaving}
                            />
                            {dept}
                          </label>
                        )
                      })}
                    </div>
                    {d.departments.length === 0 && (
                      <div className="admin-access-inline-warning">
                        No departments selected — this viewer will see nothing.
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="budget-scope-label" style={{ marginBottom: 8 }}>Linked emails</div>
                  <div className="budget-chip-list">
                    {u.emails.map((e) => (
                      <span
                        key={e}
                        className="budget-chip"
                        style={e === u.email ? { borderColor: 'color-mix(in srgb, var(--accent) 28%, var(--border))' } : undefined}
                      >
                        {e}
                        {e === u.email && <span style={{ color: 'var(--accent)', fontSize: '0.62rem' }}>primary</span>}
                        {e !== u.email && (
                          <button
                            className="budget-chip-remove"
                            onClick={() => unlinkEmail(u, e)}
                            disabled={isSaving}
                            title="Unlink"
                            aria-label={`Unlink ${e}`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <input
                      type="email"
                      className="fsearch"
                      placeholder="alias@orca.so"
                      value={d.linkEmail}
                      onChange={(e) => setDraft(u.id, { linkEmail: e.target.value })}
                      disabled={isSaving}
                      style={{ minWidth: 220 }}
                    />
                    <button
                      className="btn-secondary"
                      onClick={() => linkEmail(u)}
                      disabled={isSaving || !d.linkEmail.trim()}
                    >
                      Link email
                    </button>
                  </div>
                </div>

                <div className="admin-access-form-actions" style={{ justifyContent: 'flex-end' }}>
                  <div className="admin-access-button-row">
                    <button
                      className="btn-primary"
                      onClick={() => saveDraft(u)}
                      disabled={isSaving || !dirty}
                    >
                      {isSaving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setDrafts((p) => ({ ...p, [u.id]: emptyDraft(u) }))}
                      disabled={isSaving || !dirty}
                    >
                      Reset
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => deleteUser(u)}
                      disabled={isSaving || isMe}
                      title={isMe ? 'Cannot remove your own account' : undefined}
                      style={{ color: 'var(--red)', borderColor: 'color-mix(in srgb, var(--red) 28%, var(--border))' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
      <section className="card admin-access-settings-card" style={{ marginTop: 32 }}>
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

        <div className="admin-access-restricted-section active">
          <div className="section-title">Flags</div>
          <div className="admin-access-department-grid">
            {(['isExternal', 'overviewOnly', 'includeInOverview'] as const).map((flag) => (
              <label key={flag} className={`admin-access-department-pill${newWallet[flag] ? ' selected' : ''}`}>
                <input type="checkbox" checked={newWallet[flag]}
                  onChange={() => setNewWallet((p) => ({ ...p, [flag]: !p[flag] }))} disabled={creatingWallet} />
                {flag}
              </label>
            ))}
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
            <button className="btn-secondary" onClick={() => setNewWallet(EMPTY_NEW_WALLET)} disabled={creatingWallet}>Reset</button>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <div className="section-header">
          <div className="section-title">Wallets ({wallets?.length ?? 0})</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Chain</th><th>Label</th><th>Address</th><th>Entity</th><th>Status</th><th>Created</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(wallets ?? []).map((w) => {
                const canBackfill = w.chain === 'SOL' && !w.isExternal
                const status = w.isExternal ? 'external' : (w.chain === 'SOL' ? 'tracking' : 'balance pending')
                return (
                  <tr key={w.address}>
                    <td>{w.chain}</td>
                    <td>{w.label}</td>
                    <td title={w.address} style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                      {w.address.slice(0, 6)}…{w.address.slice(-4)}
                    </td>
                    <td>{entities.find((e) => e.id === w.entityId)?.name ?? w.entityId}</td>
                    <td>{status}</td>
                    <td>{new Date(w.createdAt).toLocaleDateString()}</td>
                    <td>
                      {canBackfill && (
                        <button className="btn-secondary" onClick={() => backfillWallet(w.address)}
                          disabled={backfillingAddr === w.address}>
                          {backfillingAddr === w.address ? 'Backfilling…' : 'Backfill'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
