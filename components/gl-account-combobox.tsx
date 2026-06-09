'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQbAccounts } from '@/lib/hooks/use-qb-accounts'
import { toGlOptions, filterGlOptions, isOrphanValue } from '@/lib/qb/account-options'

type Props = { value: string | null; entity: string | null; onChange: (next: string | null) => void; disabled?: boolean }

export function GlAccountCombobox({ value, entity, onChange, disabled }: Props) {
  const { accounts, isLoading, refresh, refreshing, refreshError } = useQbAccounts(entity)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const options = useMemo(() => toGlOptions(accounts), [accounts])
  const filtered = useMemo(() => filterGlOptions(options, query), [options, query])
  const orphan = isOrphanValue(value, accounts)
  const labelByValue = useMemo(() => new Map(options.map(o => [o.value, o.label])), [options])
  const displayLabel = value ? (labelByValue.get(value) ?? value) : '—'
  useEffect(() => { setHi(0) }, [filtered])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  function pick(next: string | null) { onChange(next); setOpen(false); setQuery('') }
  if (disabled) return <div style={{ fontSize: '0.78rem', color: 'var(--muted)', padding: '6px 0' }}>{displayLabel}</div>
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {!open ? (
        <button type="button" className="fsearch" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          style={{ textAlign: 'left', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderColor: orphan ? 'var(--red)' : undefined, color: value ? 'inherit' : 'var(--muted)' }}
          title={orphan ? `"${value}" is not in this entity's QuickBooks chart of accounts — re-select a valid account` : 'Click to choose a GL account'}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orphan ? `⚠ ${value} — not in QuickBooks` : displayLabel}</span>
          <span style={{ color: 'var(--muted)', flexShrink: 0 }}>▾</span>
        </button>
      ) : (
        <>
          <input ref={inputRef} type="text" className="fsearch" value={query} placeholder={isLoading ? 'Loading accounts…' : 'Type to search GL accounts…'} disabled={isLoading}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(filtered.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(0, i - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[hi]; if (o) pick(o.value) }
              else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQuery('') }
            }} />
          <ul role="listbox" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, zIndex: 20, maxHeight: 280, overflowY: 'auto', listStyle: 'none', padding: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontSize: '0.78rem' }}>
            {value != null && <li onMouseDown={(e) => { e.preventDefault(); pick(null) }} style={{ padding: '6px 10px', cursor: 'pointer', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>∅ Clear (unset GL)</li>}
            {filtered.length === 0 ? (
              <li style={{ padding: '8px 10px', color: 'var(--muted)' }}>
                <div style={{ color: 'var(--red)' }}>⚠ No account matching "{query.trim()}" in this entity's QuickBooks chart of accounts.</div>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); refresh() }} disabled={refreshing} style={{ marginTop: 6, fontSize: '0.74rem', cursor: refreshing ? 'wait' : 'pointer' }}>{refreshing ? '↻ Refreshing…' : '↻ Refresh from QuickBooks'}</button>
                <div style={{ marginTop: 4, fontSize: '0.7rem' }}>if you just created it in QB.</div>
                {refreshError && <div style={{ color: 'var(--red)', marginTop: 4 }}>{refreshError}</div>}
              </li>
            ) : filtered.map((o, i) => (
              <li key={o.value} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.value) }}
                style={{ padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--mono)', background: i === hi ? 'var(--accent-bg, rgba(0,122,255,0.1))' : 'transparent' }}>{o.label}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
