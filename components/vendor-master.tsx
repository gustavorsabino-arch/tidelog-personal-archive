'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { ENTITIES } from '@/lib/constants'
import { useAllQbClasses } from '@/lib/hooks/use-qb-classes'

/**
 * Vendor master (finance's Book12): which GL account + class each vendor's
 * spend belongs to. Picking a vendor on a transaction auto-fills these two.
 * Seeded once from the Book12 export; managed here from then on.
 */

type VendorRow = {
  vendorName: string
  glAccount: string
  glAccountName: string | null
  className: string | null
  updatedAt: string
  updatedBy: string | null
}

type Draft = { glAccount: string; className: string }

export default function VendorsPage() {
  const [vendors, setVendors] = useState<VendorRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // vendorName being saved/deleted
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  // New-vendor form
  const [newName, setNewName] = useState('')
  const [newGl, setNewGl] = useState('')
  const [newClass, setNewClass] = useState('')
  const [adding, setAdding] = useState(false)

  // GL options: union of the QB account catalogs across all entities,
  // deduped by account number.
  const [glOptions, setGlOptions] = useState<{ value: string; label: string; name: string }[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const byNumber = new Map<string, { value: string; label: string; name: string }>()
      for (const e of ENTITIES) {
        try {
          const res = await apiFetch<{ accounts: { qbAccountNumber: string; qbAccountName: string }[] }>(
            `/api/qb/accounts?entity=${encodeURIComponent(e)}`,
          )
          for (const a of res.accounts ?? []) {
            if (!byNumber.has(a.qbAccountNumber)) {
              byNumber.set(a.qbAccountNumber, {
                value: a.qbAccountNumber,
                label: `${a.qbAccountNumber} — ${a.qbAccountName}`,
                name: a.qbAccountName,
              })
            }
          }
        } catch { /* entity catalog unavailable — union what we have */ }
      }
      if (!cancelled) {
        setGlOptions([...byNumber.values()].sort((a, b) => a.value.localeCompare(b.value)))
      }
    })()
    return () => { cancelled = true }
  }, [])

  const { classes: allClasses } = useAllQbClasses()
  const classOptions = useMemo(
    () => [...new Set(allClasses.map((c) => c.qbClassName))].sort(),
    [allClasses],
  )

  const load = async () => {
    try {
      const res = await apiFetch<{ vendors: VendorRow[]; seeded: number }>('/api/vendors')
      setVendors(res.vendors)
      setDrafts({})
      if (res.seeded > 0) flash(`Seeded ${res.seeded} vendors from the Book12 master`)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vendors')
    }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function flash(text: string) {
    setNotice(text)
    setTimeout(() => setNotice(null), 3500)
  }

  const glNameFor = (num: string): string | null =>
    glOptions.find((o) => o.value === num)?.name ?? null

  async function addVendor() {
    if (!newName.trim() || !newGl) { setError('Vendor name and GL account are required'); return }
    setAdding(true)
    setError(null)
    try {
      await apiFetch('/api/vendors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vendorName: newName.trim(),
          glAccount: newGl,
          glAccountName: glNameFor(newGl),
          className: newClass || null,
        }),
      })
      setNewName(''); setNewGl(''); setNewClass('')
      flash('Vendor added')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setAdding(false)
    }
  }

  async function saveVendor(v: VendorRow) {
    const d = drafts[v.vendorName]
    if (!d) return
    setBusy(v.vendorName)
    setError(null)
    try {
      await apiFetch('/api/vendors', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vendorName: v.vendorName,
          glAccount: d.glAccount,
          glAccountName: glNameFor(d.glAccount),
          className: d.className || null,
        }),
      })
      flash(`${v.vendorName} updated`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  async function deleteVendor(v: VendorRow) {
    if (!window.confirm(`Remove "${v.vendorName}" from the vendor master? Transactions keep whatever was already set.`)) return
    setBusy(v.vendorName)
    setError(null)
    try {
      await apiFetch(`/api/vendors?name=${encodeURIComponent(v.vendorName)}`, { method: 'DELETE' })
      flash(`${v.vendorName} removed`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(null)
    }
  }

  const visible = (vendors ?? []).filter((v) => {
    const q = search.toLowerCase().trim()
    if (!q) return true
    return v.vendorName.toLowerCase().includes(q)
      || v.glAccount.includes(q)
      || (v.glAccountName ?? '').toLowerCase().includes(q)
      || (v.className ?? '').toLowerCase().includes(q)
  })

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Vendors</div>
          <div className="page-sub">
            Vendor master — GL account and class defaults. Picking a vendor on a transaction auto-fills both.
          </div>
        </div>
      </div>

      {notice ? (
        <div className="status-bar" style={{ marginBottom: 12 }}>
          <span className="status-dot ok" /><span className="status-text">{notice}</span>
        </div>
      ) : null}
      {error ? (
        <div className="status-bar" style={{ marginBottom: 12 }}>
          <span className="status-dot warn" /><span className="status-text">{error}</span>
        </div>
      ) : null}

      {/* Add vendor */}
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Add vendor
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="fsearch"
            style={{ minWidth: 220 }}
            placeholder="Vendor name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={adding}
          />
          <select className="fsel" style={{ minWidth: 260 }} value={newGl} onChange={(e) => setNewGl(e.target.value)} disabled={adding}>
            <option value="">GL account…</option>
            {glOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="fsel" style={{ minWidth: 160 }} value={newClass} onChange={(e) => setNewClass(e.target.value)} disabled={adding}>
            <option value="">— class</option>
            {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            className="fsel"
            onClick={() => void addVendor()}
            disabled={adding || !newName.trim() || !newGl}
            style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }}
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input className="fsearch" style={{ minWidth: 260 }} placeholder="Search vendor / account / class…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span style={{ color: 'var(--muted)', fontSize: '0.72rem', fontFamily: 'var(--mono)' }}>
          {visible.length} vendor{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      {vendors === null ? (
        <div style={{ color: 'var(--muted)', padding: 24 }}>Loading…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Vendor</th>
                <th style={{ textAlign: 'left' }}>GL account</th>
                <th style={{ textAlign: 'left' }}>Class</th>
                <th style={{ textAlign: 'left', width: 200 }}>Last edit</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((v) => {
                const d = drafts[v.vendorName] ?? { glAccount: v.glAccount, className: v.className ?? '' }
                const dirty = d.glAccount !== v.glAccount || (d.className || null) !== (v.className ?? null)
                const isBusy = busy === v.vendorName
                return (
                  <tr key={v.vendorName}>
                    <td style={{ fontWeight: 600 }}>{v.vendorName}</td>
                    <td>
                      <select
                        className="fsel"
                        style={{ minWidth: 240 }}
                        value={d.glAccount}
                        disabled={isBusy}
                        onChange={(e) => setDrafts((p) => ({ ...p, [v.vendorName]: { ...d, glAccount: e.target.value } }))}
                      >
                        {!glOptions.some((o) => o.value === v.glAccount) ? (
                          <option value={v.glAccount}>{v.glAccount}{v.glAccountName ? ` — ${v.glAccountName}` : ''}</option>
                        ) : null}
                        {glOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        className="fsel"
                        style={{ minWidth: 150 }}
                        value={d.className}
                        disabled={isBusy}
                        onChange={(e) => setDrafts((p) => ({ ...p, [v.vendorName]: { ...d, className: e.target.value } }))}
                      >
                        <option value="">— class</option>
                        {!classOptions.includes(d.className) && d.className ? (
                          <option value={d.className}>{d.className}</option>
                        ) : null}
                        {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: '0.7rem', fontFamily: 'var(--mono)' }}>
                      {v.updatedAt?.slice(0, 10)} · {v.updatedBy === 'book12-seed' ? 'Book12' : (v.updatedBy?.split('@')[0] ?? '—')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="fsel"
                          style={{ fontSize: '0.7rem' }}
                          disabled={isBusy || !dirty}
                          onClick={() => void saveVendor(v)}
                        >
                          {isBusy ? '…' : 'Save'}
                        </button>
                        <button
                          className="fsel"
                          style={{ fontSize: '0.7rem', color: 'var(--red, #d93025)' }}
                          disabled={isBusy}
                          onClick={() => void deleteVendor(v)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

