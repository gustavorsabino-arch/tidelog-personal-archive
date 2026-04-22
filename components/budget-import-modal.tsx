'use client'

import { useMemo, useRef, useState, type DragEvent } from 'react'

import { normalizeBudgetDepartmentName } from '@/lib/budget/departments'
import { apiFormFetch } from '@/lib/api'

export type BudgetImportBatchResult = {
  ok: boolean
  year: number
  succeeded: number
  failed: number
  results: Array<{
    file: string
    department: string | null
    linesImported: number
    rowsProcessed: number
    unmappedLineItems: string[]
    error: string | null
  }>
}

type BudgetImportModalProps = {
  open: boolean
  year: number
  onClose: () => void
  onImported: (result: BudgetImportBatchResult) => Promise<void> | void
}

function stripXlsxExtension(name: string): string {
  return name.replace(/\.(xlsx|xls)$/i, '')
}

type FileRow = { file: File; department: string | null }

function toFileRows(files: File[]): FileRow[] {
  return files.map((file) => ({
    file,
    department: normalizeBudgetDepartmentName(stripXlsxExtension(file.name)),
  }))
}

export function BudgetImportModal({ open, year: defaultYear, onClose, onImported }: BudgetImportModalProps) {
  const [year, setYear] = useState<number>(defaultYear)
  const [rows, setRows] = useState<FileRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BudgetImportBatchResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const unmappedCount = useMemo(() => rows.filter((row) => !row.department).length, [rows])
  const readyToImport = rows.length > 0 && !submitting

  if (!open) return null

  function reset() {
    setRows([])
    setError(null)
    setResult(null)
  }

  function handleFiles(files: FileList | File[]) {
    const accepted: File[] = []
    for (const f of Array.from(files)) {
      const lower = f.name.toLowerCase()
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) accepted.push(f)
    }
    if (accepted.length === 0) {
      setError('Only .xlsx / .xls files are supported.')
      return
    }
    setError(null)
    setResult(null)
    setRows(toFileRows(accepted))
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    if (event.dataTransfer?.files) handleFiles(event.dataTransfer.files)
  }

  async function submit() {
    if (!readyToImport) return
    setSubmitting(true)
    setError(null)
    try {
      const body = new FormData()
      body.set('year', String(year))
      for (const row of rows) body.append('files', row.file)
      const res = await apiFormFetch<BudgetImportBatchResult>('/api/budget/import/batch', body)
      await onImported(res)
      if (res.ok) {
        // Everything succeeded — parent shows the status bar, close the modal.
        reset()
        onClose()
        return
      }
      // Keep open so the user can see which files failed.
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={() => !submitting && onClose()}>
      <div
        className="modal budget-import-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">Import Budget</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <p style={{ marginBottom: 16, color: 'var(--muted)', fontSize: '0.8rem' }}>
            Drop one .xlsx per department. Department is inferred from the filename
            (e.g. <code>Engineering.xlsx</code>). Re-uploading overwrites the year for that department.
          </p>

          <label style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Year</span>
            <input
              type="number"
              className="tt-fsel"
              value={year}
              min={2024}
              max={2099}
              onChange={(e) => setYear(Number.parseInt(e.target.value, 10) || defaultYear)}
              disabled={submitting}
              style={{ width: 120 }}
            />
          </label>

          <div
            className={`budget-import-dropzone${dragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed var(--border)',
              borderRadius: 8,
              padding: 24,
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
              marginBottom: 12,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              hidden
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Drop .xlsx files here, or click to browse
            </div>
          </div>

          {rows.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 6 }}>
                {rows.length} file{rows.length === 1 ? '' : 's'} queued
                {unmappedCount > 0 ? ` · ${unmappedCount} with unknown department` : ''}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 200, overflowY: 'auto' }}>
                {rows.map((row) => (
                  <li
                    key={row.file.name}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 10px',
                      borderRadius: 4,
                      background: 'var(--surface2)',
                      marginBottom: 4,
                      fontSize: '0.78rem',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--mono)' }}>{row.file.name}</span>
                    <span style={{ color: row.department ? 'var(--accent)' : 'var(--danger, #d93025)' }}>
                      {row.department ?? 'unknown department'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="status-bar" style={{ marginBottom: 12 }}>
              <span className="status-dot warn" />
              <span className="status-text">{error}</span>
            </div>
          ) : null}

          {result ? (
            <div className="status-bar" style={{ marginBottom: 12 }}>
              <span className={`status-dot ${result.ok ? 'ok' : 'warn'}`} />
              <span className="status-text">
                Imported {result.succeeded} department{result.succeeded === 1 ? '' : 's'} for {result.year}
                {result.failed > 0 ? ` · ${result.failed} failed` : ''}
              </span>
            </div>
          ) : null}

          {result && result.results.some((r) => r.error) ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.72rem' }}>
              {result.results.filter((r) => r.error).map((r) => (
                <li key={r.file} style={{ color: 'var(--danger, #d93025)', marginBottom: 2 }}>
                  {r.file}: {r.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={reset} disabled={submitting || rows.length === 0}>
            Clear
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Close
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={!readyToImport}>
            {submitting ? 'Importing…' : `Import ${rows.length || ''} file${rows.length === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}
