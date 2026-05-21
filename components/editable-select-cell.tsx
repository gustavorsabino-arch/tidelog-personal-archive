'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditableCellState } from '@/lib/hooks/use-editable-cell-state'

export type SelectOption = {
  value: string
  label: string
}

type Props = {
  value: string | null
  defaultValue?: string                     // memorized default to show when value is null
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  // null means "clear my per-tx override; fall back to the default"
  onSave: (next: string | null) => Promise<void>
}

export function EditableSelectCell({
  value, defaultValue, options, placeholder = '—', disabled, onSave,
}: Props) {
  const s = useEditableCellState({ value, defaultValue, onSave })
  const [query, setQuery] = useState('')
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // When editing opens, reset the query and highlight the currently-selected option
  // so the user sees their current choice first.
  useEffect(() => {
    if (s.editing) {
      setQuery('')
      const currentIdx = options.findIndex(o => o.value === (value ?? defaultValue))
      setHighlightedIdx(currentIdx >= 0 ? currentIdx : 0)
      inputRef.current?.focus()
    }
  }, [s.editing, options, value, defaultValue])

  // Filter options as the user types — match against value OR label, case-insensitive substring.
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return options
    return options.filter(
      o => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    )
  }, [options, query])

  // Reset highlight when filter changes
  useEffect(() => { setHighlightedIdx(0) }, [filtered])

  // Scroll highlighted option into view
  useEffect(() => {
    if (!s.editing || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlightedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIdx, s.editing])

  // Display-side: map saved value (or default) to a label for the closed-state view.
  const optionByValue = useMemo(() => new Map(options.map(o => [o.value, o.label])), [options])
  const effective = value ?? defaultValue ?? null
  const displayLabel = effective ? (optionByValue.get(effective) ?? effective) : placeholder

  if (disabled) {
    return <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>{displayLabel}</span>
  }

  if (!s.editing) {
    const isDefault = value == null
    return (
      <span
        className="editable-cell-display"
        onClick={() => !s.saving && s.setEditing(true)}
        title={value ? 'Click to change GL' : (defaultValue ? 'Memorized default (click to override)' : 'Click to set GL')}
        style={{
          fontSize: '0.74rem',
          color: effective ? (isDefault ? 'var(--muted)' : 'inherit') : 'var(--muted)',
          fontStyle: isDefault && effective ? 'italic' : 'normal',
          cursor: s.saving ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          maxWidth: 220,
          minWidth: 80,
          padding: '2px 6px',
          borderRadius: 3,
          border: '1px solid transparent',
          background: 'transparent',
          transition: 'background 80ms, border-color 80ms',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {displayLabel}
        </span>
        {s.justSaved ? (
          <span style={{ color: 'var(--green, #10b981)', fontSize: '0.85rem', flexShrink: 0 }} title="Saved">✓</span>
        ) : (
          <span
            className="editable-cell-pencil"
            style={{ color: 'var(--muted)', fontSize: '0.7rem', flexShrink: 0, opacity: 0, transition: 'opacity 80ms' }}
          >✎</span>
        )}
      </span>
    )
  }

  function pickValue(v: string | null) {
    // Pass the value directly to commit — the hook's commit() supports an
    // explicit next-value to bypass the stale-closure path. We don't rely on
    // setText + render to propagate first because pickValue is fire-and-forget
    // and React hasn't re-rendered yet at the moment commit() runs.
    s.commit(v)
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
      {s.error && (
        <span
          title={s.error}
          aria-label={`Save failed: ${s.error}`}
          style={{ color: 'var(--red, #dc2626)', fontSize: '0.85rem', flexShrink: 0, cursor: 'help' }}
        >⚠</span>
      )}
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={s.saving}
        placeholder="Type to search GLs…"
        onChange={(e) => { setQuery(e.target.value); if (s.error) s.setError(null) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlightedIdx(i => Math.min(filtered.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlightedIdx(i => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const opt = filtered[highlightedIdx]
            if (opt) pickValue(opt.value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            s.cancel()
          }
        }}
        style={{
          fontSize: '0.74rem', flex: 1, minWidth: 0, padding: '2px 6px',
          border: `1px solid ${s.error ? 'var(--red, #dc2626)' : 'var(--accent)'}`,
          borderRadius: 3, background: 'var(--surface)',
        }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pickValue(null)}
        // Disabled when there's no override to clear — avoids the confusing
        // "click ∅, get a ✓ flash, but cell still empty" experience.
        disabled={s.saving || value == null}
        title={value == null ? 'No override to clear' : 'Clear override (saves null)'}
        aria-label="Clear"
        style={{
          flexShrink: 0, padding: '2px 6px',
          border: '1px solid var(--border)', borderRadius: 3,
          background: 'var(--surface)', color: 'var(--muted)',
          fontSize: '0.78rem', lineHeight: 1,
          cursor: s.saving ? 'wait' : (value == null ? 'not-allowed' : 'pointer'),
          opacity: value == null ? 0.4 : 1,
        }}
      >∅</button>
      <button
        type="button" onMouseDown={(e) => e.preventDefault()} onClick={s.cancel} disabled={s.saving}
        title="Cancel (Esc)" aria-label="Cancel"
        style={{
          flexShrink: 0, padding: '2px 6px',
          border: '1px solid var(--border)', borderRadius: 3,
          background: 'var(--surface)', color: 'var(--muted)',
          fontSize: '0.78rem', lineHeight: 1, cursor: s.saving ? 'wait' : 'pointer',
        }}
      >✗</button>
      <ul
        ref={listRef}
        role="listbox"
        style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: 2,
          maxHeight: 280,
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          padding: 0,
          listStyle: 'none',
          zIndex: 10,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          fontSize: '0.72rem',
        }}
      >
        {filtered.length === 0 ? (
          <li style={{ padding: '6px 10px', color: 'var(--muted)' }}>No matches</li>
        ) : filtered.map((o, i) => (
          <li
            key={o.value}
            data-idx={i}
            role="option"
            aria-selected={i === highlightedIdx}
            onMouseDown={(e) => { e.preventDefault(); pickValue(o.value) }}
            onMouseEnter={() => setHighlightedIdx(i)}
            style={{
              padding: '4px 10px',
              cursor: 'pointer',
              background: i === highlightedIdx ? 'var(--accent-bg, rgba(0, 122, 255, 0.1))' : 'transparent',
              fontFamily: 'var(--mono)',
            }}
          >
            {o.label}
          </li>
        ))}
      </ul>
    </span>
  )
}
