'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'

type App = {
  appName: string
  description: string | null
  paymentTerm: string | null
  paymentMethod: string | null
  amount: string | null
  classTeam: string | null
  accountOwner: string | null
}
type Draft = Record<keyof App, string>
const fields: { key: keyof App; label: string }[] = [
  { key: 'appName', label: 'App name' },
  { key: 'description', label: 'Description' },
  { key: 'paymentTerm', label: 'Payment term' },
  { key: 'paymentMethod', label: 'Payment method' },
  { key: 'amount', label: 'Amount' },
  { key: 'classTeam', label: 'Class/team' },
  { key: 'accountOwner', label: 'Account owner' },
]
const empty = (): Draft => ({ appName: '', description: '', paymentTerm: '', paymentMethod: '', amount: '', classTeam: '', accountOwner: '' })
const toDraft = (app: App): Draft => Object.fromEntries(fields.map(({ key }) => [key, app[key] ?? ''])) as Draft

export default function AppsCatalog() {
  const [apps, setApps] = useState<App[] | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(empty)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const visible = useMemo(() => (apps ?? []).filter((app) =>
    fields.some(({ key }) => (app[key] ?? '').toLowerCase().includes(search.trim().toLowerCase()))), [apps, search])

  async function load() {
    try {
      const result = await apiFetch<{ apps: App[] }>('/api/apps')
      setApps(result.apps)
      setError(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load apps') }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function change(key: keyof App, value: string) { setDraft((previous) => ({ ...previous, [key]: value })) }
  function startAdd() { setAdding(true); setEditing(null); setDraft(empty()); setError(null) }
  function startEdit(app: App) { setEditing(app.appName); setAdding(false); setDraft(toDraft(app)); setError(null) }
  function cancel() { setAdding(false); setEditing(null); setDraft(empty()) }

  async function save() {
    if (!draft.appName.trim()) { setError('App name is required'); return }
    setBusy(true); setError(null)
    try {
      await apiFetch('/api/apps', {
        method: adding ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, ...(!adding ? { originalName: editing } : {}) }),
      })
      cancel(); await load(); setNotice(adding ? 'App added' : 'App updated')
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed') }
    finally { setBusy(false) }
  }

  async function remove(app: App) {
    if (!window.confirm(`Delete "${app.appName}" from Apps?`)) return
    setBusy(true); setError(null)
    try {
      await apiFetch(`/api/apps?name=${encodeURIComponent(app.appName)}`, { method: 'DELETE' })
      await load(); setNotice('App deleted')
    } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed') }
    finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-header"><div><div className="page-title">Apps</div><div className="page-sub">Current apps from the app audit. Amounts are shown as recorded in the source.</div></div></div>
      {error && <div className="status-bar" style={{ marginBottom: 12 }}><span className="status-dot warn" /><span className="status-text">{error}</span></div>}
      {notice && <div className="status-bar" style={{ marginBottom: 12 }}><span className="status-dot ok" /><span className="status-text">{notice}</span></div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="fsearch" aria-label="Search apps" placeholder="Search apps…" value={search} onChange={(event) => setSearch(event.target.value)} style={{ minWidth: 260 }} />
        <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{visible.length} apps</span>
        <button className="fsel" type="button" onClick={startAdd} disabled={busy} style={{ marginLeft: 'auto', background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff', fontWeight: 600 }}>+ Add app</button>
      </div>
      {(adding || editing) && <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>{adding ? 'Add app' : `Edit ${editing}`}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          {fields.map(({ key, label }) => <label key={key} style={{ display: 'grid', gap: 5, fontSize: '0.75rem', color: 'var(--muted)' }}>{label}<input className="fsearch" style={{ width: '100%', minWidth: 0 }} value={draft[key]} onChange={(event) => change(key, event.target.value)} disabled={busy} /></label>)}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><button type="button" className="fsel" onClick={() => void save()} disabled={busy || !draft.appName.trim()}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="fsel" onClick={cancel} disabled={busy}>Cancel</button></div>
      </div>}
      {apps === null ? <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div> :
        <div className="table-wrap"><table style={{ minWidth: 1270, tableLayout: 'fixed' }}><colgroup>{[145, 210, 150, 140, 220, 125, 150, 130].map((width, index) => <col key={index} style={{ width }} />)}</colgroup><thead><tr>{fields.map(({ key, label }) => <th key={key} style={{ textAlign: 'left' }}>{label}</th>)}<th /></tr></thead><tbody>
          {visible.map((app) => <tr key={app.appName}>{fields.map(({ key }) => <td key={key} style={{ whiteSpace: 'normal', overflowWrap: 'break-word', fontWeight: key === 'appName' ? 600 : undefined }}>{app[key] || '—'}</td>)}<td><div style={{ display: 'flex', gap: 6 }}><button className="fsel" type="button" onClick={() => startEdit(app)} disabled={busy}>Edit</button><button className="fsel" type="button" onClick={() => void remove(app)} disabled={busy} style={{ color: 'var(--red, #d93025)' }}>Delete</button></div></td></tr>)}
        </tbody></table></div>}
    </div>
  )
}
