'use client'
import { useState, useEffect } from 'react'

type Args = {
  value: string | null
  defaultValue: string | undefined
  onSave: (next: string | null) => Promise<void>
  alwaysSave?: boolean
}

/**
 * Shared state + lifecycle for inline-editable cells (EditableCell text variant,
 * EditableSelectCell searchable dropdown variant, possibly more in Wave 2c).
 *
 *   editing       — is the user currently editing?
 *   text          — the in-progress value (mirrors `value` when not editing)
 *   saving        — request in-flight
 *   justSaved     — true for ~900ms after a successful save (drives the ✓ flash)
 *   error         — message if onSave threw; UI shows the ⚠ + red border
 *
 * commit() — calls onSave, handles success/error, exits edit on success.
 * cancel() — reverts local state, exits edit. Never calls onSave.
 *
 * The "matches default → save null" logic stays here so both cell variants
 * collapse-to-null consistently when the user types/picks something equal
 * to the computed default.
 */
export function useEditableCellState({ value, defaultValue, onSave, alwaysSave = false }: Args) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value ?? defaultValue ?? '')
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync text when external value/default changes (e.g. parent re-fetch),
  // but only when NOT actively editing — don't blow away mid-edit input.
  useEffect(() => {
    if (!editing) setText(value ?? defaultValue ?? '')
  }, [value, defaultValue, editing])

  /**
   * Commit the edit.
   *
   * - Called WITHOUT arguments (text-input case): reads `text` from React
   *   state. The user has typed across multiple renders so `text` is current
   *   by the time they press Enter / click Save.
   * - Called WITH explicit `nextValue` (dropdown/picker case): uses that
   *   value directly. Bypasses a stale-closure bug where
   *   `pickValue → setText(v) → commit()` runs synchronously and commit's
   *   closure still sees the old `text` because React hasn't re-rendered.
   */
  async function commit(nextValue?: string | null) {
    setSaving(true)
    setError(null)
    try {
      let next: string | null
      if (nextValue !== undefined) {
        next = nextValue
      } else {
        const trimmed = text.trim()
        const isEmpty = trimmed === ''
        const matchesDefault = trimmed === (defaultValue ?? '')
        next = isEmpty || matchesDefault ? null : trimmed
      }
      if (next !== value || alwaysSave) await onSave(next)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 900)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      // Stay in edit mode so user can retry or cancel
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setText(value ?? defaultValue ?? '')
    setError(null)
    setEditing(false)
  }

  return {
    editing, setEditing,
    text, setText,
    saving, justSaved, error, setError,
    commit, cancel,
  }
}
