'use client'
import { useState, useEffect, useRef } from 'react'

/**
 * Inline-editable text cell. Behavior:
 *  - Renders `defaultValue ?? placeholder` muted+italic when `value` is null
 *    (signals "no user override; this is the computed default").
 *  - Click → input focused. Blur or Enter → onSave(text|null).
 *  - Empty text → save null (revert to default).
 *  - Text equal to defaultValue → save null (treat as "no override needed").
 *  - Escape → cancel without saving.
 *  - `disabled` renders read-only (used in Wave 2c for posted rows).
 *
 * Reused in:
 *  - Wave 2a: description column
 *  - Wave 2b: counterparty GL override (will wrap with a <select> variant —
 *    same lifecycle, different inner render — but for 2a this is plain input).
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
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (!editing) {
    const display = value ?? defaultValue ?? placeholder
    const isDefault = value == null
    return (
      <span
        onClick={() => !saving && setEditing(true)}
        title={value ? 'Click to edit' : 'Default (click to override)'}
        style={{
          fontSize: '0.74rem',
          color: isDefault ? 'var(--muted)' : 'inherit',
          fontStyle: isDefault ? 'italic' : 'normal',
          cursor: saving ? 'wait' : 'pointer',
          display: 'inline-block',
          maxWidth: 280,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {display || <em style={{ color: 'var(--muted)' }}>—</em>}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      maxLength={maxLength}
      disabled={saving}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') {
          setText(value ?? defaultValue ?? '')
          setEditing(false)
        }
      }}
      style={{
        fontSize: '0.74rem',
        width: '100%',
        padding: '2px 4px',
        border: '1px solid var(--accent)',
        borderRadius: 3,
        background: 'var(--surface)',
      }}
    />
  )
}
