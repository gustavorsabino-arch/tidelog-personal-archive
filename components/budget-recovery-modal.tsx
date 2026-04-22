'use client'

import { useEffect, useMemo, useState } from 'react'

import { apiFetch, apiPost } from '@/lib/api'
import { getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { BUDGET_DEPTS } from '@/lib/constants'
import type { BudgetDepartment, BudgetImportRecoveryInfo, BudgetPeriodKey } from '@/lib/budget/types'

type BudgetRecoveryModalProps = {
  open: boolean
  year: number
  onClose: () => void
  onRecovered: (message: string) => Promise<void> | void
}

type RecoveryAction = 'clear-periods' | 'restore-version' | 'reset-department'

function formatPeriodLabel(period: BudgetPeriodKey): string {
  if (period === 'annual') return 'Annual'
  return new Date(2000, Number.parseInt(period, 10) - 1, 1).toLocaleString(undefined, { month: 'long' })
}

export function BudgetRecoveryModal({ open, year, onClose, onRecovered }: BudgetRecoveryModalProps) {
  const [department, setDepartment] = useState<BudgetDepartment>('Engineering')
  const [selectedPeriods, setSelectedPeriods] = useState<BudgetPeriodKey[]>([])
  const [selectedHistorySha, setSelectedHistorySha] = useState('')
  const [info, setInfo] = useState<BudgetImportRecoveryInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<RecoveryAction | null>(null)

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
    setConfirmAction(null)
    setError(null)
    setSelectedPeriods([])
    setSelectedHistorySha('')
  }, [open, department, year])

  async function loadInfo() {
    setLoading(true)
    setError(null)
    try {
      const nextInfo = await apiFetch<BudgetImportRecoveryInfo>(
        `/api/budget/import/recovery?year=${year}&department=${encodeURIComponent(department)}`,
      )
      setInfo(nextInfo)
      setSelectedPeriods([])
      setSelectedHistorySha(nextInfo.history.find((entry) => entry.restorable && !entry.isCurrent)?.sha ?? '')
    } catch (loadError) {
      setInfo(null)
      setSelectedPeriods([])
      setSelectedHistorySha('')
      setError(loadError instanceof Error ? loadError.message : 'Failed to load recovery info')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return

    let cancelled = false

    async function loadInfoSafely() {
      setLoading(true)
      setError(null)
      try {
        const nextInfo = await apiFetch<BudgetImportRecoveryInfo>(
          `/api/budget/import/recovery?year=${year}&department=${encodeURIComponent(department)}`,
        )
        if (cancelled) return
        setInfo(nextInfo)
        setSelectedPeriods([])
        setSelectedHistorySha(nextInfo.history.find((entry) => entry.restorable && !entry.isCurrent)?.sha ?? '')
      } catch (loadError) {
        if (cancelled) return
        setInfo(null)
        setSelectedPeriods([])
        setSelectedHistorySha('')
        setError(loadError instanceof Error ? loadError.message : 'Failed to load recovery info')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadInfoSafely()
    return () => {
      cancelled = true
    }
  }, [open, department, year])

  const restorableHistory = info?.history.filter((entry) => entry.restorable && !entry.isCurrent) ?? []
  const currentImportLabel = info?.importMeta?.lastImportedAt
    ? new Date(info.importMeta.lastImportedAt).toLocaleString()
    : 'No import metadata'
  const departmentLabel = getBudgetDepartmentLabel(department)

  const canClearPeriods = selectedPeriods.length > 0
  const selectedRestoreEntry = useMemo(() => {
    return info?.history.find((entry) => entry.sha === selectedHistorySha) ?? null
  }, [info, selectedHistorySha])

  function togglePeriod(period: BudgetPeriodKey) {
    setSelectedPeriods((current) =>
      current.includes(period) ? current.filter((entry) => entry !== period) : [...current, period],
    )
  }

  async function runRecovery(action: RecoveryAction) {
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiPost<{ success: true; deletedFile?: boolean; restoredCommitSha?: string | null }>(
        '/api/budget/import/recovery',
        action === 'clear-periods'
          ? { action, year, department, periods: selectedPeriods }
          : action === 'restore-version'
            ? { action, year, department, sha: selectedHistorySha }
            : { action, year, department },
      )

      const message =
        action === 'clear-periods'
          ? `Cleared ${selectedPeriods.map(formatPeriodLabel).join(', ')} for ${departmentLabel} in ${year}.`
          : action === 'restore-version'
            ? `Restored ${departmentLabel} in ${year} to ${selectedRestoreEntry?.sha.slice(0, 7) ?? 'the selected version'}.`
            : `Reset ${departmentLabel} in ${year}. The current imported plan file was removed.`

      setConfirmAction(null)
      await onRecovered(message)
      if (response.success) {
        await loadInfo()
      }
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : 'Recovery failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={() => !submitting && onClose()}>
      <div className="modal budget-recovery-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Recover Budget Import</div>
            <div className="modal-sub">Remove selected imported periods, reset the current department file, or restore a specific historical version.</div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close recovery modal">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="budget-recovery-top-grid">
            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Department</span>
              <select className="tt-fsel" value={department} onChange={(event) => setDepartment(event.target.value as BudgetDepartment)}>
                {BUDGET_DEPTS.map((dept) => (
                  <option key={dept} value={dept}>{getBudgetDepartmentLabel(dept)}</option>
                ))}
              </select>
            </label>

            <div className="budget-import-field">
              <span className="card-label budget-import-field-label">Imported Periods</span>
              <div className="budget-recovery-period-list">
                {info?.periods.length ? (
                  info.periods.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      className={`dept-pill${selectedPeriods.includes(entry) ? ' active' : ''}`}
                      onClick={() => togglePeriod(entry)}
                    >
                      {formatPeriodLabel(entry)}
                    </button>
                  ))
                ) : (
                  <span className="budget-section-note">No imported periods</span>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="status-bar" style={{ marginTop: 12 }}>
              <span className="status-dot loading" />
              <span className="status-text">Loading recovery information…</span>
            </div>
          ) : info ? (
            <div className="budget-recovery-summary">
              <div className="budget-import-result-grid">
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">Imported Periods</span>
                  <strong>{info.periods.length}</strong>
                </div>
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">Last Import</span>
                  <strong>{currentImportLabel}</strong>
                </div>
                <div className="budget-import-result-card">
                  <span className="budget-import-result-label">History Entries</span>
                  <strong>{info.history.length}</strong>
                </div>
              </div>

              <div className="budget-import-guidance">
                <span className="budget-section-note">Path: {info.filePath}</span>
                <span className="budget-section-note">Current periods: {info.periods.length ? info.periods.map(formatPeriodLabel).join(', ') : 'None'}</span>
                <span className="budget-section-note">Select periods to remove, reset the current file to start fresh, or choose a historical version to restore.</span>
                <span className="budget-section-note">Git history remains archival; this flow resets current state but does not erase past commits.</span>
              </div>

              {info.history.length > 0 && (
                <div className="budget-recovery-history">
                  <div className="budget-import-result-label">Recent file history</div>
                  <div className="budget-import-preview-list">
                    {info.history.map((entry) => (
                      <button
                        key={entry.sha}
                        type="button"
                        className={`budget-import-preview-card budget-history-card${selectedHistorySha === entry.sha ? ' selected' : ''}`}
                        onClick={() => {
                          if (entry.restorable && !entry.isCurrent) setSelectedHistorySha(entry.sha)
                        }}
                        disabled={!entry.restorable || entry.isCurrent}
                      >
                        <div className="budget-import-preview-card-head">
                          <strong>{entry.message}</strong>
                          <span>{entry.committedAt ? new Date(entry.committedAt).toLocaleString() : 'Unknown time'}</span>
                        </div>
                        <div className="budget-section-note">
                          {entry.authorName ? `Author: ${entry.authorName}` : 'Author unavailable'} · {entry.sha.slice(0, 7)}
                        </div>
                        <div className="budget-history-flags">
                          {entry.isCurrent && <span className="budget-history-badge">Current</span>}
                          {!entry.isCurrent && entry.restorable && <span className="budget-history-badge ok">Restorable</span>}
                          {!entry.restorable && !entry.isCurrent && <span className="budget-history-badge muted">File unavailable</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {confirmAction && (
            <div className="status-bar budget-import-confirm">
              <span className="status-dot warn" />
              <span className="status-text">
                {confirmAction === 'clear-periods'
                  ? `Clear ${selectedPeriods.map(formatPeriodLabel).join(', ')} for ${departmentLabel}? This removes only those imported periods from the current file.`
                  : confirmAction === 'restore-version'
                    ? `Restore ${departmentLabel} from ${selectedRestoreEntry?.message || 'the selected history entry'}? This replaces the whole current department file with that historical version.`
                    : `Reset ${departmentLabel} for ${year}? This removes the current imported plan file so the page starts from scratch for this department.`}
              </span>
            </div>
          )}

          {error && (
            <div className="status-bar" style={{ marginTop: 12 }}>
              <span className="status-dot error" />
              <span className="status-text">{error}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span>{info?.hasImportedPlan ? 'Imported plan file available' : 'No imported plan file yet'}</span>
          <div className="budget-import-footer-actions">
            {confirmAction ? (
              <>
                <button className="btn-secondary" onClick={() => setConfirmAction(null)} disabled={submitting}>Cancel</button>
                <button className="btn-primary" onClick={() => void runRecovery(confirmAction)} disabled={submitting}>
                  {submitting ? 'Applying…' : 'Confirm'}
                </button>
              </>
            ) : (
              <>
                <button className="btn-secondary" onClick={onClose} disabled={submitting}>Done</button>
                <button
                  className="btn-secondary"
                  onClick={() => setConfirmAction('reset-department')}
                  disabled={submitting || !info?.hasImportedPlan}
                >
                  Reset Department
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setConfirmAction('clear-periods')}
                  disabled={submitting || !canClearPeriods}
                >
                  Clear Selected
                </button>
                <button
                  className="btn-primary"
                  onClick={() => setConfirmAction('restore-version')}
                  disabled={submitting || !selectedRestoreEntry || !restorableHistory.length}
                >
                  Restore Selected Version
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
