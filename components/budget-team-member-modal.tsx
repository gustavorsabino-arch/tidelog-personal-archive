'use client'

import { useEffect, useMemo, useState } from 'react'

import { apiPost } from '@/lib/api'
import { getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { BUDGET_DEPTS, ENTITIES } from '@/lib/constants'
import type {
  BudgetDepartment,
  BudgetMonthKey,
  BudgetTeamMember,
  BudgetTeamMemberInput,
  BudgetTeamMutationResult,
} from '@/lib/budget/types'

type BudgetTeamMemberModalProps = {
  open: boolean
  year: number
  member: BudgetTeamMember | null
  defaultDepartment?: BudgetDepartment | ''
  onClose: () => void
  onSaved: (result: BudgetTeamMutationResult) => Promise<void> | void
}

type TeamFormState = BudgetTeamMemberInput

function buildInitialState(
  member: BudgetTeamMember | null,
  defaultDepartment?: BudgetDepartment | '',
): TeamFormState {
  if (member) {
    const { id: _id, ...rest } = member
    return rest
  }

  return {
    name: '',
    email: '',
    dept: defaultDepartment || 'Engineering',
    role: '',
    salary: 0,
    bonus: 0,
    status: 'Current',
    entity: ENTITIES[0],
    classification: 'Employee',
    location: '',
    ft: 'FT',
    terminationMonth: null,
    startDate: null,
    terminationDate: null,
  }
}

export function BudgetTeamMemberModal({
  open,
  year,
  member,
  defaultDepartment,
  onClose,
  onSaved,
}: BudgetTeamMemberModalProps) {
  const [form, setForm] = useState<TeamFormState>(buildInitialState(member, defaultDepartment))
  const [submitting, setSubmitting] = useState(false)
  const [confirmTerminate, setConfirmTerminate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(buildInitialState(member, defaultDepartment))
    setSubmitting(false)
    setConfirmTerminate(false)
    setError(null)
  }, [defaultDepartment, member, open, year])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, submitting])

  const mode = member ? 'edit' : 'create'
  const title = mode === 'edit' ? 'Edit Team Member' : 'Add Team Member'

  const saveLabel = useMemo(() => {
    if (submitting) return mode === 'edit' ? 'Saving…' : 'Adding…'
    return mode === 'edit' ? 'Save Changes' : 'Add Team Member'
  }, [mode, submitting])

  function updateField<Key extends keyof TeamFormState>(key: Key, value: TeamFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit() {
    setSubmitting(true)
    setError(null)

    try {
      const result = await apiPost<BudgetTeamMutationResult>('/api/budget/team', {
        action: mode === 'edit' ? 'update-member' : 'create-member',
        year,
        ...(member ? { memberId: member.id } : {}),
        member: form,
      })
      await onSaved(result)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save team member')
    } finally {
      setSubmitting(false)
    }
  }

  async function terminateMember() {
    if (!member) return
    if (!form.terminationDate) {
      setError('Enter the last day of work before terminating this member.')
      return
    }
    if (!confirmTerminate) {
      setConfirmTerminate(true)
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const result = await apiPost<BudgetTeamMutationResult>('/api/budget/team', {
        action: 'terminate-member',
        year,
        memberId: member.id,
        terminationMonth: form.terminationDate.slice(5, 7),
        terminationDate: form.terminationDate,
      })
      await onSaved(result)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to terminate team member')
    } finally {
      setSubmitting(false)
    }
  }

  async function restoreMember() {
    if (!member) return

    setSubmitting(true)
    setError(null)

    try {
      const result = await apiPost<BudgetTeamMutationResult>('/api/budget/team', {
        action: 'restore-member',
        year,
        memberId: member.id,
      })
      await onSaved(result)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to restore team member')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={() => !submitting && onClose()}>
      <div className="modal budget-team-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{title}</div>
            <div className="modal-sub">
              Update the team roster and employment dates for {year}.
            </div>
          </div>
          <button className="modal-close" onClick={() => !submitting && onClose()} aria-label="Close team modal">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="budget-team-form-grid">
            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Name</span>
              <input
                className="tt-search"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="Full name"
              />
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Email</span>
              <input
                className="tt-search"
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                placeholder="name@orca.so"
              />
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Department</span>
              <select className="tt-fsel" value={form.dept} onChange={(event) => updateField('dept', event.target.value as BudgetDepartment)}>
                {BUDGET_DEPTS.map((dept) => (
                  <option key={dept} value={dept}>{getBudgetDepartmentLabel(dept)}</option>
                ))}
              </select>
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Role</span>
              <input
                className="tt-search"
                value={form.role}
                onChange={(event) => updateField('role', event.target.value)}
                placeholder="Role title"
              />
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Entity</span>
              <select className="tt-fsel" value={form.entity} onChange={(event) => updateField('entity', event.target.value)}>
                {ENTITIES.map((entity) => (
                  <option key={entity} value={entity}>{entity}</option>
                ))}
              </select>
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Status</span>
              <select
                className="tt-fsel"
                value={form.status}
                onChange={(event) => {
                  const nextStatus = event.target.value as BudgetTeamMember['status']
                  setForm((current) => ({
                    ...current,
                    status: nextStatus,
                    terminationMonth: nextStatus === 'Terminated' ? current.terminationMonth : null,
                  }))
                }}
              >
                <option value="Current">Current</option>
                <option value="Terminated">Terminated</option>
              </select>
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Start Date</span>
              <input className="tt-search" type="date" value={form.startDate ?? ''}
                onChange={(event) => updateField('startDate', event.target.value || null)} />
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Last Day</span>
              <input className="tt-search" type="date" value={form.terminationDate ?? ''}
                onChange={(event) => setForm((current) => ({
                  ...current, terminationDate: event.target.value || null,
                  terminationMonth: event.target.value ? event.target.value.slice(5, 7) as BudgetMonthKey : null,
                }))} />
            </label>


            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Classification</span>
              <input
                className="tt-search"
                value={form.classification}
                onChange={(event) => updateField('classification', event.target.value)}
                placeholder="Employee / Contractor"
              />
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">FT/PT</span>
              <input
                className="tt-search"
                value={form.ft}
                onChange={(event) => updateField('ft', event.target.value)}
                placeholder="FT"
              />
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Location</span>
              <input
                className="tt-search"
                value={form.location}
                onChange={(event) => updateField('location', event.target.value)}
                placeholder="Country / region"
              />
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Salary</span>
              <input
                className="tt-search"
                inputMode="decimal"
                value={String(form.salary)}
                onChange={(event) => updateField('salary', Number(event.target.value || 0))}
                placeholder="0"
              />
            </label>

            <label className="budget-import-field">
              <span className="card-label budget-import-field-label">Bonus</span>
              <input
                className="tt-search"
                inputMode="decimal"
                value={String(form.bonus)}
                onChange={(event) => updateField('bonus', Number(event.target.value || 0))}
                placeholder="0"
              />
            </label>
          </div>

          {error && (
            <div className="status-bar budget-import-confirm" style={{ marginTop: 14 }}>
              <span className="status-dot err" />
              <span className="status-text">{error}</span>
            </div>
          )}

          {confirmTerminate && member && (
            <div className="budget-team-delete-warning">
              Terminate <strong>{member.name}</strong> in {year}? This keeps the teammate in the canonical file for audit history and marks them as off-roster.
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div>
            {member ? `Editing member #${member.id}` : 'New member'}
          </div>
          <div className="budget-team-modal-actions">
            {member && member.status !== 'Terminated' ? (
              <button className={`btn-secondary ${confirmTerminate ? 'danger' : ''}`} onClick={terminateMember} disabled={submitting}>
                {confirmTerminate ? 'Confirm Terminate' : 'Terminate'}
              </button>
            ) : null}
            {member && member.status === 'Terminated' ? (
              <button className="btn-secondary" onClick={restoreMember} disabled={submitting}>
                Restore
              </button>
            ) : null}
            {confirmTerminate ? (
              <button className="btn-secondary" onClick={() => setConfirmTerminate(false)} disabled={submitting}>
                Cancel Terminate
              </button>
            ) : null}
            <button className="btn-secondary" onClick={onClose} disabled={submitting}>Close</button>
            <button className="btn-primary" onClick={submit} disabled={submitting}>{saveLabel}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
