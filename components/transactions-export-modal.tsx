'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { apiFetch } from '@/lib/api'
import { ENTITIES } from '@/lib/constants'
import type { Transaction } from '@/lib/types'
import {
  buildPostedTransactionsWorkbook,
  buildPostedTxExportFilename,
} from '@/lib/transactions-export'

const MONTHS: { value: number; label: string }[] = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' }, { value: 4, label: 'April' },
  { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' },
  { value: 9, label: 'September' }, { value: 10, label: 'October' },
  { value: 11, label: 'November' }, { value: 12, label: 'December' },
]

type TransactionsExportModalProps = {
  open: boolean
  onClose: () => void
  // Sensible defaults from the current page state — pre-selects the entity/
  // year/month the operator was already looking at.
  defaultEntity: string
  defaultYear: number
  defaultMonth: number
}

export function TransactionsExportModal({
  open,
  onClose,
  defaultEntity,
  defaultYear,
  defaultMonth,
}: TransactionsExportModalProps) {
  const [entity, setEntity] = useState<string>(defaultEntity)
  const [year, setYear] = useState<number>(defaultYear)
  const [month, setMonth] = useState<number>(defaultMonth)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setEntity(defaultEntity)
      setYear(defaultYear)
      setMonth(defaultMonth)
      setError(null)
      setProgress(null)
      setBusy(false)
    }
  }, [open, defaultEntity, defaultYear, defaultMonth])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const currentYear = new Date().getUTCFullYear()
  const yearOptions: number[] = []
  for (let y = 2022; y <= currentYear; y++) yearOptions.push(y)

  async function handleExport() {
    setBusy(true); setError(null); setProgress(null)
    try {
      // Build month range as unix seconds (inclusive bounds — endpoint
      // uses gte/lte).
      const from = Math.floor(Date.UTC(year, month - 1, 1) / 1000)
      const to = Math.floor(Date.UTC(year, month, 1) / 1000) - 1

      const entitiesToFetch = entity === 'all' ? [...ENTITIES] : [entity]
      const txnsByEntity: Record<string, Transaction[]> = {}

      for (let i = 0; i < entitiesToFetch.length; i++) {
        const e = entitiesToFetch[i]
        setProgress(`Fetching ${e}… (${i + 1}/${entitiesToFetch.length})`)
        const params = new URLSearchParams({
          entity: e,
          from: String(from),
          to: String(to),
          qbStatus: 'posted',
          limit: 'all',
        })
        const res = await apiFetch<{ transactions: Transaction[] }>(
          `/api/treasury/transactions?${params.toString()}`,
        )
        txnsByEntity[e] = res.transactions ?? []
      }

      const totalTxns = Object.values(txnsByEntity).reduce((s, arr) => s + arr.length, 0)
      if (totalTxns === 0) {
        setError(`No posted transactions found for ${
          entity === 'all' ? 'any entity' : entity
        } in ${MONTHS[month - 1].label} ${year}.`)
        setProgress(null)
        setBusy(false)
        return
      }

      setProgress('Building spreadsheet…')
      const wb = buildPostedTransactionsWorkbook({
        txnsByEntity,
        periodLabel: `${MONTHS[month - 1].label} ${year}`,
      })
      const filename = buildPostedTxExportFilename({
        entityLabel: entity === 'all' ? 'all-entities' : entity,
        year,
        month,
      })
      XLSX.writeFile(wb, filename)

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div
        className="modal"
        style={{ width: '440px', maxWidth: '95vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="modal-title">Export posted transactions</span>
            <div className="modal-sub" style={{ marginTop: 4 }}>
              Downloads .xlsx of every transaction with QB status = posted for the
              selected month + entity.
            </div>
          </div>
          <button
            className="modal-close"
            onClick={() => { if (!busy) onClose() }}
            aria-label="Close export modal"
          >×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Year</span>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                disabled={busy}
                className="fsel"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Month</span>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                disabled={busy}
                className="fsel"
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Entity</span>
              <select
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                disabled={busy}
                className="fsel"
              >
                {ENTITIES.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
                <option value="all">All entities (one sheet per entity)</option>
              </select>
            </label>
          </div>

          {progress ? (
            <div style={{ marginTop: 16, fontSize: '0.8rem', color: 'var(--muted)' }}>
              {progress}
            </div>
          ) : null}

          {error ? (
            <div style={{
              marginTop: 16,
              padding: '8px 12px',
              background: 'rgba(229, 80, 80, 0.1)',
              color: 'var(--red, #b00)',
              fontSize: '0.8rem',
              borderRadius: 4,
            }}>
              {error}
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          <button
            className="fsel"
            onClick={() => { if (!busy) onClose() }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="fsel"
            onClick={handleExport}
            disabled={busy}
            style={{
              background: 'var(--accent)',
              color: '#fff',
              borderColor: 'var(--accent)',
              fontWeight: 600,
            }}
          >
            {busy ? 'Exporting…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  )
}
