'use client'

import { useState } from 'react'

import { apiFormFetch, apiPost } from '@/lib/api'
import { fmtUSD } from '@/lib/format'
import type { TeamImportOp } from '@/lib/budget/team-import'

type BudgetTeamImportModalProps = {
  open: boolean
  onClose: () => void
  onImported: (summary: { added: number; updated: number; deactivated: number }) => Promise<void> | void
}

type PreviewResponse = { rowsParsed: number; ops: TeamImportOp[] }

function opLabel(op: TeamImportOp): string {
  if (op.type === 'add') {
    return `${op.input.name} — ${op.input.dept} · ${op.input.role} · ${fmtUSD(op.input.salary, 0)}`
  }
  if (op.type === 'update') {
    return `${op.memberName} — ${op.changes.join(', ')}`
  }
  return `${op.memberName} — not in the file`
}

export function BudgetTeamImportModal({ open, onClose, onImported }: BudgetTeamImportModalProps) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [checked, setChecked] = useState<boolean[]>([])
  const [fileName, setFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  function reset() {
    setPreview(null)
    setChecked([])
    setFileName('')
    setError(null)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setSubmitting(true)
    setError(null)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await apiFormFetch<PreviewResponse>('/api/budget/team/import', body)
      setPreview(res)
      setFileName(file.name)
      // Adds + updates default ON; deactivations of members merely missing from
      // the file default OFF — the operator opts in per person.
      setChecked(res.ops.map((op) => op.type !== 'deactivate'))
    } catch (err) {
      const e = err as { payload?: { error?: string } }
      setError(e.payload?.error ?? (err instanceof Error ? err.message : 'Failed to read the workbook.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function apply() {
    if (!preview) return
    const ops = preview.ops.filter((_, i) => checked[i])
    if (ops.length === 0) { setError('Nothing selected to apply.'); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiPost<{ ok: boolean; added: number; updated: number; deactivated: number }>(
        '/api/budget/team/import',
        { apply: true, ops },
      )
      await onImported({ added: res.added, updated: res.updated, deactivated: res.deactivated })
      reset()
      onClose()
    } catch (err) {
      const e = err as { payload?: { error?: string } }
      setError(e.payload?.error ?? (err instanceof Error ? err.message : 'Import failed.'))
    } finally {
      setSubmitting(false)
    }
  }

  const groups: Array<{ title: string; type: TeamImportOp['type']; hint?: string }> = [
    { title: 'New people (will be added)', type: 'add' },
    { title: 'Updates', type: 'update' },
    { title: 'Not in the file (tick to mark as left)', type: 'deactivate', hint: 'Unticked people are left untouched.' },
  ]

  return (
    <div className="modal-overlay open" onClick={() => !submitting && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div className="modal-title">Import team from MASTER workbook</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          {!preview ? (
            <>
              <p style={{ marginBottom: 12, color: 'var(--muted)', fontSize: '0.8rem' }}>
                Upload the <strong>Team Tracker - MASTER</strong> .xlsx. Only the first numbered block
                (the current team, e.g. rows 1–23) is read. Salary comes from the <strong>Stables</strong> column;
                bonus is not imported. Nothing is written until you review and apply.
              </p>
              <label className="btn-secondary" style={{ display: 'inline-block', cursor: 'pointer' }}>
                {submitting ? 'Reading…' : 'Choose .xlsx…'}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  hidden
                  disabled={submitting}
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
              </label>
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 10 }}>
                {fileName} · {preview.rowsParsed} people in the team block ·{' '}
                {preview.ops.length === 0 ? 'everything already matches — nothing to change' : `${preview.ops.length} proposed change(s)`}
              </div>

              {groups.map((group) => {
                const entries = preview.ops
                  .map((op, index) => ({ op, index }))
                  .filter(({ op }) => op.type === group.type)
                if (entries.length === 0) return null
                return (
                  <div key={group.type} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 4 }}>
                      {group.title} ({entries.length})
                    </div>
                    {group.hint ? (
                      <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginBottom: 4 }}>{group.hint}</div>
                    ) : null}
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 180, overflowY: 'auto' }}>
                      {entries.map(({ op, index }) => (
                        <li key={index} style={{ padding: '4px 8px', background: 'var(--surface2)', borderRadius: 4, marginBottom: 3, fontSize: '0.74rem' }}>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={checked[index] ?? false}
                              disabled={submitting}
                              onChange={() => setChecked((prev) => prev.map((v, i) => (i === index ? !v : v)))}
                            />
                            <span>{opLabel(op)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </>
          )}

          {error ? (
            <div className="status-bar" style={{ marginTop: 8 }}>
              <span className="status-dot warn" />
              <span className="status-text">{error}</span>
            </div>
          ) : null}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {preview ? (
            <button type="button" className="btn-secondary" onClick={reset} disabled={submitting}>
              ← Different file
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          {preview ? (
            <button type="button" className="btn-primary" onClick={apply} disabled={submitting || preview.ops.length === 0}>
              {submitting ? 'Applying…' : `Apply ${checked.filter(Boolean).length} change(s)`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
