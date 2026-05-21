'use client'
import { useState, useEffect, useRef } from 'react'

/**
 * Inline-editable text cell. Behavior:
 *  - Renders `defaultValue ?? placeholder` muted+italic when `value` is null
 *    (signals "no user override; this is the computed default"). A small ✎
 *    pencil icon appears on hover to make the edit affordance discoverable.
 *  - Click → input + Save (✓) / Cancel (✗) buttons. Save commits, Cancel reverts.
 *  - Keyboard: Enter = save, Escape = cancel.
 *  - Blur does NOT save — user must explicitly commit. Prevents accidental
 *    saves when the cursor wanders mid-edit (important for accounting data).
 *  - Empty text or text matching the computed default → save null (revert).
 *  - After successful save, a brief green ✓ flash confirms the commit.
 *  - `disabled` renders read-only (used in Wave 2c for posted rows).
 *
 * Reused in:
 *  - Wave 2a: description column
 *  - Wave 2b: counterparty GL override (planned — same lifecycle, dropdown
 *    variant of the input)
 */
type Props = {
  value: string | null
  defaultValue?: string
  placeholder?: string
  disabled?: boolean
  onSave: (next: string | null) => Promise<void>
  maxLength?: number
}

export function EditableCell({
  value,
  defaultValue,
  placeholder = '',
  disabled,
  onSave,
  maxLength = 4000,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value ?? defaultValue ?? '')
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-sync local state when the row's data changes from outside (e.g. parent refetched)
  useEffect(() => {
    if (!editing) setText(value ?? defaultValue ?? '')
  }, [value, defaultValue, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  if (disabled) {
    return (
      <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
        {value ?? defaultValue ?? placeholder}
      </span>
    )
  }

  async function commit() {
    setSaving(true)
    try {
      const trimmed = text.trim()
      const isEmpty = trimmed === ''
      const matchesDefault = trimmed === (defaultValue ?? '')
      const next = isEmpty || matchesDefault ? null : trimmed
      if (next !== value) await onSave(next)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 900)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function cancel() {
    setText(value ?? defaultValue ?? '')
    setEditing(false)
  }

  if (!editing) {
    const display = value ?? defaultValue ?? placeholder
    const isDefault = value == null
    return (
      <span
        className="editable-cell-display"
        onClick={() => !saving && setEditing(true)}
        title={value ? 'Click to edit description' : 'Default (click to edit description)'}
        style={{
          fontSize: '0.74rem',
          color: isDefault ? 'var(--muted)' : 'inherit',
          fontStyle: isDefault ? 'italic' : 'normal',
          cursor: saving ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          maxWidth: 280,
          minWidth: 60,
          padding: '2px 6px',
          borderRadius: 3,
          border: '1px solid transparent',
          background: 'transparent',
          transition: 'background 80ms, border-color 80ms',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {display || <em style={{ color: 'var(--muted)' }}>—</em>}
        </span>
        {justSaved ? (
          <span style={{ color: 'var(--green, #10b981)', fontSize: '0.85rem', flexShrink: 0 }} title="Saved">✓</span>
        ) : (
          <span
            className="editable-cell-pencil"
            style={{
              color: 'var(--muted)',
              fontSize: '0.7rem',
              flexShrink: 0,
              opacity: 0,
              transition: 'opacity 80ms',
            }}
          >✎</span>
        )}
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        value={text}
        maxLength={maxLength}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') cancel()
        }}
        style={{
          fontSize: '0.74rem',
          flex: 1,
          minWidth: 0,
          padding: '2px 6px',
          border: '1px solid var(--accent)',
          borderRadius: 3,
          background: 'var(--surface)',
        }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={commit}
        disabled={saving}
        title="Save (Enter)"
        aria-label="Save"
        style={{
          flexShrink: 0,
          padding: '2px 6px',
          border: '1px solid var(--green, #10b981)',
          borderRadius: 3,
          background: 'var(--green, #10b981)',
          color: 'white',
          fontSize: '0.78rem',
          lineHeight: 1,
          cursor: saving ? 'wait' : 'pointer',
        }}
      >✓</button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancel}
        disabled={saving}
        title="Cancel (Esc)"
        aria-label="Cancel"
        style={{
          flexShrink: 0,
          padding: '2px 6px',
          border: '1px solid var(--border)',
          borderRadius: 3,
          background: 'var(--surface)',
          color: 'var(--muted)',
          fontSize: '0.78rem',
          lineHeight: 1,
          cursor: saving ? 'wait' : 'pointer',
        }}
      >✗</button>
    </span>
  )
}
