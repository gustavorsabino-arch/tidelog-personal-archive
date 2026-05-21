'use client'
import { useEffect, useRef } from 'react'
import { useEditableCellState } from '@/lib/hooks/use-editable-cell-state'

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
 * State/lifecycle is owned by `useEditableCellState` so EditableSelectCell
 * (Wave 2b) can share identical commit/cancel/justSaved/error semantics.
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
  const s = useEditableCellState({ value, defaultValue, onSave })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (s.editing) inputRef.current?.focus()
  }, [s.editing])

  if (disabled) {
    return (
      <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
        {value ?? defaultValue ?? placeholder}
      </span>
    )
  }

  if (!s.editing) {
    const display = value ?? defaultValue ?? placeholder
    const isDefault = value == null
    return (
      <span
        className="editable-cell-display"
        onClick={() => !s.saving && s.setEditing(true)}
        title={value ? 'Click to edit description' : 'Default (click to edit description)'}
        style={{
          fontSize: '0.74rem',
          color: isDefault ? 'var(--muted)' : 'inherit',
          fontStyle: isDefault ? 'italic' : 'normal',
          cursor: s.saving ? 'wait' : 'pointer',
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
        {s.justSaved ? (
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
      {s.error && (
        <span
          title={s.error}
          aria-label={`Save failed: ${s.error}`}
          style={{
            color: 'var(--red, #dc2626)',
            fontSize: '0.85rem',
            flexShrink: 0,
            cursor: 'help',
          }}
        >⚠</span>
      )}
      <input
        ref={inputRef}
        type="text"
        value={s.text}
        maxLength={maxLength}
        disabled={s.saving}
        onChange={(e) => { s.setText(e.target.value); if (s.error) s.setError(null) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') s.commit()
          else if (e.key === 'Escape') s.cancel()
        }}
        style={{
          fontSize: '0.74rem',
          flex: 1,
          minWidth: 0,
          padding: '2px 6px',
          border: `1px solid ${s.error ? 'var(--red, #dc2626)' : 'var(--accent)'}`,
          borderRadius: 3,
          background: 'var(--surface)',
        }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => s.commit()}
        disabled={s.saving}
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
          cursor: s.saving ? 'wait' : 'pointer',
        }}
      >✓</button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={s.cancel}
        disabled={s.saving}
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
          cursor: s.saving ? 'wait' : 'pointer',
        }}
      >✗</button>
    </span>
  )
}
