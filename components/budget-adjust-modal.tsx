'use client'

import { useState } from 'react'

import { apiPost } from '@/lib/api'

const MONTHS: Array<{ value: string; label: string }> = [
  { value: '01', label: 'January' }, { value: '02', label: 'February' },
  { value: '03', label: 'March' }, { value: '04', label: 'April' },
  { value: '05', label: 'May' }, { value: '06', label: 'June' },
  { value: '07', label: 'July' }, { value: '08', label: 'August' },
  { value: '09', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
]

export type BudgetAdjustLineOption = { key: string; label: string }

type BudgetAdjustModalProps = {
  open: boolean
  year: number
  departments: readonly string[]
  lineItems: BudgetAdjustLineOption[]
  onClose: () => void
  onSaved: () => Promise<void> | void
}

export function BudgetAdjustModal({ open, year, departments, lineItems, onClose, onSaved }: BudgetAdjustModalProps) {
  const [department, setDepartment] = useState('')
  const [lineItem, setLineItem] = useState('')
  const [amountText, setAmountText] = useState('')
  const [kind, setKind] = useState<'one_time' | 'recurring'>('one_time')
  const [startPeriod, setStartPeriod] = useState('10')
  const [durationMonths, setDurationMonths] = useState(3)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const amount = Number(amountText.replace(/[,$\s]/g, ''))
  const amountValid = Number.isFinite(amount) && amount !== 0
  const ready = !!department && !!lineItem && amountValid && notes.trim().length > 0 && !submitting

  function reset() {
    setDepartment(''); setLineItem(''); setAmountText(''); setKind('one_time')
    setStartPeriod('10'); setDurationMonths(3); setNotes(''); setError(null)
  }

  async function submit() {
    if (!ready) return
    setSubmitting(true)
    setError(null)
    try {
      await apiPost('/api/budget/adjustments', {
        year,
        department,
        lineItem,
        kind,
        amount,
        startPeriod,
        durationMonths: kind === 'recurring' ? durationMonths : 1,
        notes: notes.trim(),
      })
      await onSaved()
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save adjustment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={() => !submitting && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div className="modal-title">Adjust budget · {year}</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 500 }}>
            Amount (use a minus sign to reduce)
            <input
              type="text"
              className="tt-fsel"
              placeholder="+10000 or -10000"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              disabled={submitting}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>

          <label style={{ fontSize: '0.78rem', fontWeight: 500 }}>
            Department
            <select className="tt-fsel" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={submitting} style={{ width: '100%', marginTop: 4 }}>
              <option value="">— choose —</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>

          <label style={{ fontSize: '0.78rem', fontWeight: 500 }}>
            Line item
            <select className="tt-fsel" value={lineItem} onChange={(e) => setLineItem(e.target.value)} disabled={submitting} style={{ width: '100%', marginTop: 4 }}>
              <option value="">— choose —</option>
              {lineItems.map((li) => <option key={li.key} value={li.key}>{li.label}</option>)}
            </select>
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={kind === 'one_time' ? 'btn-primary' : 'btn-secondary'} onClick={() => setKind('one_time')} disabled={submitting} style={{ flex: 1, fontSize: '0.78rem' }}>One-time</button>
            <button type="button" className={kind === 'recurring' ? 'btn-primary' : 'btn-secondary'} onClick={() => setKind('recurring')} disabled={submitting} style={{ flex: 1, fontSize: '0.78rem' }}>Recurring</button>
          </div>

          <label style={{ fontSize: '0.78rem', fontWeight: 500 }}>
            {kind === 'one_time' ? 'Month' : 'Starting month'}
            <select className="tt-fsel" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} disabled={submitting} style={{ width: '100%', marginTop: 4 }}>
              {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>

          {kind === 'recurring' ? (
            <label style={{ fontSize: '0.78rem', fontWeight: 500 }}>
              For how many months
              <input type="number" min={1} max={12} className="tt-fsel" value={durationMonths} onChange={(e) => setDurationMonths(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} disabled={submitting} style={{ width: '100%', marginTop: 4 }} />
            </label>
          ) : null}

          <label style={{ fontSize: '0.78rem', fontWeight: 500 }}>
            Notes (required — why are you adjusting?)
            <textarea className="tt-fsel" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} rows={3} style={{ width: '100%', marginTop: 4, resize: 'vertical' }} />
          </label>

          {error ? (
            <div className="status-bar"><span className="status-dot warn" /><span className="status-text">{error}</span></div>
          ) : null}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={!ready}>
            {submitting ? 'Saving…' : 'Save adjustment'}
          </button>
        </div>
      </div>
    </div>
  )
}
