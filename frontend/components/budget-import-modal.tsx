'use client'

import { useEffect, useMemo, useState } from 'react'

import { apiFormFetch } from '@/lib/api'
import { formatBudgetDepartmentList, getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { BUDGET_DEPTS } from '@/lib/constants'
import { fmtUSD } from '@/lib/format'
import { getBudgetImportWorkbookGuide } from '@/lib/budget/import-spec'
import type { BudgetImportPreviewResult, BudgetImportSuccessResult } from '@/lib/budget/types'

type BudgetImportModalProps = {
  open: boolean
  year: number
  onClose: () => void
  onImported: (result: BudgetImportSuccessResult) => Promise<void> | void
}

const PERIOD_OPTIONS = [
  { value: 'annual', label: 'All Months' },
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

type ImportConflictPayload = {
  needsConfirmation?: boolean
  existingDepartments?: string[]
  message?: string
}

type ImportErrorPayload = ImportConflictPayload & {
  detail?: string
  expectedWorkbook?: string
  departmentsMissing?: string[]
}

function getPeriodLabel(period: string): string {
  return PERIOD_OPTIONS.find((option) => option.value === period)?.label || period
}

function formatImportedPeriods(periods: readonly string[]): string {
  if (periods.length === 0) return 'None'
  if (periods.length === 1 && periods[0] === 'annual') return 'Annual'
  if (periods.every((period) => period !== 'annual')) {
    return periods.map((period) => getPeriodLabel(period)).join(', ')
  }
  return periods.map((period) => getPeriodLabel(period)).join(', ')
}

function formatImportError(importError: unknown): string {
  if (!(importError instanceof Error)) return 'Import failed'

  const payload = (importError as Error & { payload?: ImportErrorPayload }).payload
  const messages = [importError.message]
  const detail = typeof payload?.detail === 'string' ? payload.detail.trim() : ''
  if (detail && !messages.includes(detail)) messages.push(detail)

  const expectedWorkbook = typeof payload?.expectedWorkbook === 'string' ? payload.expectedWorkbook.trim() : ''
  if (expectedWorkbook && !messages.includes(expectedWorkbook)) {
    messages.push(expectedWorkbook)
  } else if (Array.isArray(payload?.departmentsMissing) && payload.departmentsMissing.length > 0) {
    messages.push(`Workbook is missing department sheets for ${formatBudgetDepartmentList(payload.departmentsMissing)}.`)
  }

  return messages.join(' ')
}

export function BudgetImportModal({ open, year, onClose, onImported }: BudgetImportModalProps) {
  const [department, setDepartment] = useState('All')
  const [period, setPeriod] = useState('annual')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BudgetImportSuccessResult | null>(null)
  const [preview, setPreview] = useState<BudgetImportPreviewResult | null>(null)
  const [conflict, setConflict] = useState<ImportConflictPayload | null>(null)

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, submitting])

  useEffect(() => {
    if (!open) return
    setError(null)
    setResult(null)
    setPreview(null)
    setConflict(null)
    setDepartment('All')
    setPeriod('annual')
    setFile(null)
  }, [open, year])

  useEffect(() => {
    if (!open) return
    setPreview(null)
    setResult(null)
    setConflict(null)
    setError(null)
  }, [department, open, period])

  const submitLabel = useMemo(() => {
    if (submitting) return 'Importing…'
    if (preview?.existingDepartments.length || conflict?.needsConfirmation) return 'Overwrite Existing Plan'
    return 'Import Plan'
  }, [conflict, preview, submitting])

  const previewLabel = useMemo(() => {
    if (previewing) return 'Previewing…'
    return preview ? 'Refresh Preview' : 'Preview Changes'
  }, [preview, previewing])

  const totalPreviewChanges = useMemo(() => {
    return preview?.preview.reduce((sum, departmentPreview) => sum + departmentPreview.diff.length, 0) ?? 0
  }, [preview])
  const workbookGuide = useMemo(
    () => getBudgetImportWorkbookGuide(
      department === 'All'
        ? 'All'
        : department as (typeof BUDGET_DEPTS)[number],
    ),
    [department],
  )
  const selectedPeriodBehavior = useMemo(() => {
    if (period === 'annual') {
      return 'All Months imports every detected month column from each matching department tab.'
    }
    return `${getPeriodLabel(period)} imports only the ${getPeriodLabel(period)} column from each matching department tab.`
  }, [period])

  async function previewImport() {
    if (!file) {
      setError('Select an Excel workbook first.')
      return
    }

    setPreviewing(true)
    setError(null)
    setConflict(null)
    setResult(null)

    const body = new FormData()
    body.set('file', file)
    body.set('year', String(year))
    body.set('period', period)
    body.set('department', department)

    try {
      const response = await apiFormFetch<BudgetImportPreviewResult>('/api/budget/import/preview', body)
      setPreview(response)
    } catch (previewError) {
      setPreview(null)
      setError(formatImportError(previewError))
    } finally {
      setPreviewing(false)
    }
  }

  async function submitImport(overwrite = false) {
    if (!preview) {
      setError('Preview the import before applying it.')
      return
    }

    if (!file) {
      setError('Select an Excel workbook first.')
      return
    }

    setSubmitting(true)
    setError(null)

    const body = new FormData()
    body.set('file', file)
    body.set('year', String(year))
    body.set('period', period)
    body.set('department', department)
    if (overwrite) body.set('overwrite', 'true')

    try {
      const response = await apiFormFetch<BudgetImportSuccessResult>('/api/budget/import', body)
      setConflict(null)
      setResult(response)
      await onImported(response)
    } catch (importError) {
      const maybeConflict = importError as Error & { status?: number; payload?: ImportConflictPayload }
      if (maybeConflict.status === 409 && maybeConflict.payload?.needsConfirmation) {
        setConflict(maybeConflict.payload)
      } else {
        setError(formatImportError(importError))
      }
    } finally {
      setSubmitting(false)
    }
  }

  function resetAndClose() {
    if (submitting) return
    setError(null)
    setResult(null)
    setPreview(null)
    setConflict(null)
    setFile(null)
    onClose()
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={resetAndClose}>
      <div className="modal budget-import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Import v1 Budget Workbook</div>
            <div className="modal-sub">
              Upload the v1 budget workbook and normalize it into canonical plan files for {year}.
            </div>
          </div>
          <button className="modal-close" onClick={resetAndClose} aria-label="Close import modal">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="budget-import-modal-grid">
            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Department</span>
              <select className="tt-fsel" value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="All">All departments</option>
                {BUDGET_DEPTS.map((dept) => (
                  <option key={dept} value={dept}>{getBudgetDepartmentLabel(dept)}</option>
                ))}
              </select>
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Period</span>
              <select className="tt-fsel" value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="budget-import-field budget-import-field-wide">
            <span className="card-label budget-import-field-label">Workbook</span>
            <input
              id="budget-import-file"
              type="file"
              accept=".xlsx,.xls"
              className="tt-search budget-import-file-input"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
                setPreview(null)
                setResult(null)
                setConflict(null)
              }}
            />
          </label>

          <div className="budget-import-guidance">
            <span className="budget-section-note">Year: {year}</span>
            <span className="budget-section-note">Period: {getPeriodLabel(period)}</span>
            <span className="budget-section-note">
              For complete Overview and Department reports, use <strong>All departments</strong> with a workbook that has one sheet per department.
            </span>
            <span className="budget-section-note">{selectedPeriodBehavior}</span>
            <span className="budget-section-note">Preview changes before the plan files are updated.</span>
          </div>

          <div className="budget-import-spec">
            <div className="budget-import-result-title">v1 Workbook Contract</div>
            <div className="budget-import-result-grid">
              <div className="budget-import-result-card">
                <span className="budget-import-result-label">Workbook</span>
                <strong>{workbookGuide.workbookCount} Excel workbook</strong>
                <div className="budget-section-note" style={{ marginTop: 8 }}>
                  {department === 'All'
                    ? `${workbookGuide.requiredDepartmentSheets.length} department tabs are needed for full Overview and Department parity.`
                    : `Use the ${getBudgetDepartmentLabel(department)} tab, or a compatible single-department fallback tab.`}
                </div>
              </div>
              <div className="budget-import-result-card">
                <span className="budget-import-result-label">Month Headers</span>
                <strong>Jan-Dec within first {workbookGuide.monthHeaderScanLimit} rows</strong>
                <div className="budget-section-note" style={{ marginTop: 8 }}>
                  The parser looks for at least {workbookGuide.minimumMonthHeaders} month headers before treating a tab as a v1 monthly budget sheet.
                </div>
              </div>
              <div className="budget-import-result-card">
                <span className="budget-import-result-label">Line Items</span>
                <strong>Column {workbookGuide.primaryLineItemColumn} with {workbookGuide.fallbackLineItemColumn} fallback</strong>
                <div className="budget-section-note" style={{ marginTop: 8 }}>
                  Totals are ignored so only leaf budget rows are imported into the canonical plan files.
                </div>
              </div>
            </div>

            <div className="budget-import-spec-list">
              <div className="budget-import-result-label">Department tabs</div>
              <div className="budget-import-chip-list">
                {workbookGuide.requiredDepartmentSheets.map((sheetDepartment) => (
                  <span key={sheetDepartment} className="budget-import-chip">{getBudgetDepartmentLabel(sheetDepartment)}</span>
                ))}
              </div>
            </div>

            <div className="budget-import-spec-list">
              <div className="budget-import-result-label">Legacy aliases</div>
              <div className="budget-import-chip-list">
                {workbookGuide.sheetAliases.map(({ sheetName, department: mappedDepartment }) => (
                  <span key={`${sheetName}-${mappedDepartment}`} className="budget-import-chip">
                    <strong>{sheetName}</strong> {'->'} {getBudgetDepartmentLabel(mappedDepartment)}
                  </span>
                ))}
              </div>
            </div>

            {department !== 'All' && (
              <div className="budget-import-spec-list">
                <div className="budget-import-result-label">Single-department fallback tabs</div>
                <div className="budget-import-chip-list">
                  {workbookGuide.fallbackSheetNames.map((sheetName) => (
                    <span key={sheetName} className="budget-import-chip">{sheetName}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {preview && (
            <div className="budget-import-preview">
              <div className="budget-import-result-title">Preview</div>
              <div className="budget-import-result-grid">
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">Departments</span>
                  <strong>{formatBudgetDepartmentList(preview.departmentsProcessed)}</strong>
                </div>
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">Changed Lines</span>
                  <strong>{totalPreviewChanges}</strong>
                </div>
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">Imported Periods</span>
                  <strong>{formatImportedPeriods(preview.importedPeriods)}</strong>
                </div>
              </div>

              {preview.departmentsMissing.length > 0 && (
                <div className="status-bar budget-import-confirm">
                  <span className="status-dot warn" />
                  <span className="status-text">
                    Workbook is missing department sheets for {formatBudgetDepartmentList(preview.departmentsMissing)}.
                  </span>
                </div>
              )}

              {preview.existingDepartments.length > 0 && (
                <div className="status-bar budget-import-confirm">
                  <span className="status-dot warn" />
                  <span className="status-text">
                    This import will replace {formatImportedPeriods(preview.importedPeriods)} for {formatBudgetDepartmentList(preview.existingDepartments)}.
                  </span>
                </div>
              )}

              <div className="budget-import-preview-list">
                {preview.preview.map((departmentPreview) => (
                  <div key={departmentPreview.department} className="budget-import-preview-card">
                    <div className="budget-import-preview-card-head">
                      <strong>{getBudgetDepartmentLabel(departmentPreview.department)}</strong>
                      <span>{departmentPreview.diff.length} changed line{departmentPreview.diff.length === 1 ? '' : 's'} · {formatImportedPeriods(departmentPreview.importedPeriods)}</span>
                    </div>
                    {departmentPreview.existingPeriods.length > 0 ? (
                      <div className="budget-section-note" style={{ marginBottom: 10 }}>
                        Existing data found for {formatImportedPeriods(departmentPreview.existingPeriods)}.
                      </div>
                    ) : null}
                    {departmentPreview.diff.length > 0 ? (
                      <div className="budget-import-preview-table">
                        {departmentPreview.diff.slice(0, 8).map((entry) => (
                          <div key={`${departmentPreview.department}-${entry.key}`} className="budget-import-preview-row">
                            <div>
                              <div className="budget-line-label">{entry.label}</div>
                              <div className="budget-line-category">{entry.category}</div>
                            </div>
                            <div className="budget-import-preview-values">
                              <span>{fmtUSD(entry.beforeUsd, 0)}</span>
                              <span>→</span>
                              <span>{fmtUSD(entry.afterUsd, 0)}</span>
                              <span className={`budget-import-preview-delta ${entry.deltaUsd >= 0 ? 'up' : 'down'}`}>
                                {entry.deltaUsd >= 0 ? '+' : ''}{fmtUSD(entry.deltaUsd, 0)}
                              </span>
                            </div>
                          </div>
                        ))}
                        {departmentPreview.diff.length > 8 && (
                          <div className="budget-section-note">
                            Showing the largest 8 changes out of {departmentPreview.diff.length}.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="budget-section-note">No line-level changes detected for this department.</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {conflict?.needsConfirmation && (
            <div className="status-bar budget-import-confirm">
              <span className="status-dot warn" />
              <span className="status-text">{conflict.message || 'Existing budget data was found.'}</span>
            </div>
          )}

          {error && (
            <div className="status-bar" style={{ marginTop: 12 }}>
              <span className="status-dot error" />
              <span className="status-text">{error}</span>
            </div>
          )}

          {result && (
            <div className="budget-import-result">
              <div className="budget-import-result-title">Import Complete</div>
              <div className="budget-import-result-grid">
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">Departments</span>
                  <strong>{result.departmentsProcessed.join(', ')}</strong>
                </div>
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">Rows Parsed</span>
                  <strong>{result.totalRows}</strong>
                </div>
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">Imported Periods</span>
                  <strong>{formatImportedPeriods(result.importedPeriods)}</strong>
                </div>
              </div>
              <div className="budget-import-result-list">
                <div className="budget-import-result-label">Keys Imported</div>
                <div>{result.totalKeys}</div>
              </div>
              {result.unmappedLineItems.length > 0 && (
                <div className="budget-import-result-list">
                  <div className="budget-import-result-label">Unmapped line items</div>
                  <ul>
                    {result.unmappedLineItems.map((lineItem) => (
                      <li key={lineItem}>{lineItem}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span>{file ? `${file.name}` : 'No workbook selected'}</span>
          <div className="budget-import-footer-actions">
            <button className="btn-secondary" onClick={resetAndClose} disabled={submitting}>
              {result ? 'Done' : 'Cancel'}
            </button>
            {!result && (
              <>
                <button className="btn-secondary" onClick={() => void previewImport()} disabled={submitting || previewing}>
                  {previewLabel}
                </button>
                <button
                  className="btn-primary"
                  onClick={() => void submitImport(Boolean(preview?.existingDepartments.length || conflict?.needsConfirmation))}
                  disabled={submitting || previewing || !preview}
                >
                  {submitLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
