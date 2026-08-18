'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiFormFetch } from '@/lib/api'
import { useSharedAccess } from '@/lib/access-context'
import { hasPermission } from '@/lib/auth/permissions'
import { DataTable } from '@/components/data-table'
import { Skeleton } from '@/components/skeleton'
import { ENTITIES, BUDGET_DEPTS } from '@/lib/constants'
import { fmtUSD } from '@/lib/format'

/**
 * Approvals — Bill.com-style payment approval workflow.
 *
 * Roles:
 *  - approvals:submit (budget_viewer + admin): create requests, see own list,
 *    cancel own pending requests.
 *  - approvals:approve / approvals:admin (admin): see everything, decide on
 *    others' requests (never their own — SOX separation of duties), mark
 *    approved requests paid.
 *
 * SOX capture (client leg): the review timer starts when the detail modal
 * mounts; clientReviewMs rides on the decide call as corroboration for the
 * server-computed duration (server side is authoritative).
 */

type ApprovalRow = {
  id: string
  refNumber: string
  submitterId: string
  submitterEmail: string | null
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled'
  vendorName: string
  description: string | null
  amount: string
  currency: string
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  glAccount: string | null
  department: string | null
  entity: string | null
  paymentType: string | null
  submittedAt: string
  decidedAt: string | null
  decisionNote: string | null
  paidAt: string | null
  paymentReference: string | null
  attachmentCount: number
}

type AttachmentMeta = {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  sha256: string
  uploadedAt: string
}

type DetailResponse = {
  request: ApprovalRow
  attachments: AttachmentMeta[]
  viewer: {
    isAdmin: boolean
    isSubmitter: boolean
    canDecide: boolean
    canPay: boolean
    canCancel: boolean
  }
}

type AuditEvent = {
  id: string
  action: string
  at: string
  actorEmail: string | null
  metadata: Record<string, unknown>
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'approval.submitted': 'Submitted',
  'approval.viewed': 'Opened for review',
  'approval.approved': 'Approved',
  'approval.rejected': 'Rejected',
  'approval.paid': 'Marked paid',
  'approval.cancelled': 'Cancelled',
  'approval.attachment_downloaded': 'Attachment downloaded',
}

function fmtReviewMs(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

const PAYMENT_TYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'wire', label: 'Wire' },
  { value: 'ach', label: 'ACH' },
  { value: 'crypto', label: 'Crypto (USDC/SOL/…)' },
  { value: 'card', label: 'Card' },
  { value: 'check', label: 'Check' },
  { value: 'other', label: 'Other' },
]

const STATUS_STYLE: Record<ApprovalRow['status'], { bg: string; fg: string; label: string }> = {
  pending:   { bg: 'rgba(212,160,23,0.15)', fg: '#D4A017', label: 'Pending' },
  approved:  { bg: 'rgba(6,214,160,0.15)',  fg: '#06D6A0', label: 'Approved' },
  rejected:  { bg: 'rgba(217,48,37,0.12)',  fg: '#d93025', label: 'Rejected' },
  paid:      { bg: 'rgba(39,117,202,0.15)', fg: '#2775ca', label: 'Paid' },
  cancelled: { bg: 'rgba(136,136,136,0.15)', fg: '#888888', label: 'Cancelled' },
}

type NewRequestForm = {
  vendorName: string
  description: string
  amount: string
  currency: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string
  glAccount: string
  department: string
  entity: string
  paymentType: string
}

const EMPTY_FORM: NewRequestForm = {
  vendorName: '', description: '', amount: '', currency: 'USD',
  invoiceNumber: '', invoiceDate: '', dueDate: '',
  glAccount: '', department: '', entity: '', paymentType: '',
}

export function ApprovalsPageClient() {
  const { access } = useSharedAccess()
  const isAdmin = access?.role === 'admin'
  const canApprove = hasPermission(access?.role, 'approvals:approve')

  const [rows, setRows] = useState<ApprovalRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [notice, setNotice] = useState<string | null>(null)

  // New-request modal
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<NewRequestForm>(EMPTY_FORM)
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Detail/review modal
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  // SOX client-side review timer — started when the detail modal opens.
  const reviewStartRef = useRef<number | null>(null)

  const loadList = useCallback(async () => {
    try {
      const res = await apiFetch<{ requests: ApprovalRow[] }>('/api/approvals')
      setRows(res.requests)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load approvals')
    }
  }, [])

  useEffect(() => { void loadList() }, [loadList])

  function flash(text: string) {
    setNotice(text)
    setTimeout(() => setNotice(null), 3500)
  }

  async function openDetail(id: string) {
    setDetailLoading(true)
    setDetailError(null)
    setDecisionNote('')
    setPaymentRef('')
    setAuditEvents(null)
    try {
      const res = await apiFetch<DetailResponse>(`/api/approvals/${id}`)
      setDetail(res)
      reviewStartRef.current = Date.now()
      // Admins also get the SOX audit trail — fetched separately so a trail
      // failure never blocks the request detail.
      if (res.viewer.isAdmin) {
        apiFetch<{ events: AuditEvent[] }>(`/api/approvals/${id}/audit`)
          .then((a) => setAuditEvents(a.events))
          .catch(() => setAuditEvents([]))
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load request')
    } finally {
      setDetailLoading(false)
    }
  }

  function closeDetail() {
    setDetail(null)
    reviewStartRef.current = null
    setDetailError(null)
    setAuditEvents(null)
  }

  async function submitNewRequest() {
    setFormError(null)
    if (!form.vendorName.trim()) { setFormError('Vendor is required'); return }
    const amount = parseFloat(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('Amount must be a positive number'); return }

    setSubmitting(true)
    try {
      const fd = new FormData()
      for (const [k, v] of Object.entries(form)) {
        if (v) fd.append(k, v)
      }
      for (const f of files) fd.append('attachments', f)
      await apiFormFetch('/api/approvals', fd)
      setFormOpen(false)
      setForm(EMPTY_FORM)
      setFiles([])
      flash('Request submitted for approval')
      void loadList()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function decide(decision: 'approved' | 'rejected') {
    if (!detail) return
    if (decision === 'rejected' && !decisionNote.trim()) {
      setDetailError('A note explaining the rejection is required')
      return
    }
    setActionBusy(true)
    setDetailError(null)
    try {
      const clientReviewMs = reviewStartRef.current ? Date.now() - reviewStartRef.current : null
      await apiFetch(`/api/approvals/${detail.request.id}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, note: decisionNote.trim() || undefined, clientReviewMs }),
      })
      flash(decision === 'approved' ? `✓ ${detail.request.refNumber} approved` : `✗ ${detail.request.refNumber} rejected`)
      closeDetail()
      void loadList()
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActionBusy(false)
    }
  }

  async function markPaid() {
    if (!detail) return
    if (!paymentRef.trim()) { setDetailError('Payment reference is required (tx hash / wire ref)'); return }
    setActionBusy(true)
    setDetailError(null)
    try {
      await apiFetch(`/api/approvals/${detail.request.id}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentReference: paymentRef.trim() }),
      })
      flash(`💸 ${detail.request.refNumber} marked as paid`)
      closeDetail()
      void loadList()
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActionBusy(false)
    }
  }

  async function cancelRequest() {
    if (!detail) return
    if (!confirm(`Cancel ${detail.request.refNumber}? This cannot be undone.`)) return
    setActionBusy(true)
    setDetailError(null)
    try {
      await apiFetch(`/api/approvals/${detail.request.id}/cancel`, { method: 'POST' })
      flash(`${detail.request.refNumber} cancelled`)
      closeDetail()
      void loadList()
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActionBusy(false)
    }
  }

  const visibleRows = (rows ?? []).filter(r => !statusFilter || r.status === statusFilter)

  const columns = [
    {
      key: 'refNumber', label: 'Ref', width: '90px',
      render: (r: ApprovalRow) => <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{r.refNumber}</span>,
    },
    {
      key: 'status', label: 'Status', width: '110px',
      render: (r: ApprovalRow) => {
        const s = STATUS_STYLE[r.status]
        return (
          <span style={{
            display: 'inline-block', padding: '2px 10px', borderRadius: 999,
            background: s.bg, color: s.fg, fontSize: '0.7rem', fontWeight: 700,
            fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{s.label}</span>
        )
      },
    },
    {
      key: 'vendorName', label: 'Vendor', sortable: true,
      render: (r: ApprovalRow) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.vendorName}</div>
          {r.invoiceNumber ? (
            <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Inv {r.invoiceNumber}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'amount', label: 'Amount', numeric: true, sortable: true, width: '130px',
      render: (r: ApprovalRow) => (
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
          {r.currency === 'USD' ? fmtUSD(Number(r.amount)) : `${Number(r.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${r.currency}`}
        </span>
      ),
    },
    {
      key: 'entity', label: 'Entity', width: '110px',
      render: (r: ApprovalRow) => <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{r.entity || '—'}</span>,
    },
    ...(isAdmin ? [{
      key: 'submitterEmail', label: 'Submitter', sortable: true,
      render: (r: ApprovalRow) => <span style={{ fontSize: '0.75rem' }}>{r.submitterEmail || '—'}</span>,
    }] : []),
    {
      key: 'submittedAt', label: 'Submitted', sortable: true, width: '110px',
      render: (r: ApprovalRow) => (
        <span style={{ color: 'var(--muted)', fontSize: '0.72rem', fontFamily: 'var(--mono)' }}>
          {r.submittedAt?.slice(0, 10) || '—'}
        </span>
      ),
    },
    {
      key: 'attachmentCount', label: 'Files', width: '60px',
      render: (r: ApprovalRow) => (
        <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
          {r.attachmentCount > 0 ? `📎 ${r.attachmentCount}` : '—'}
        </span>
      ),
    },
    {
      key: 'id', label: '', width: '90px',
      render: (r: ApprovalRow) => (
        <button className="btn-secondary" style={{ fontSize: '0.72rem', padding: '3px 12px' }} onClick={() => void openDetail(r.id)}>
          {canApprove && r.status === 'pending' && r.submitterEmail !== access?.email ? 'Review' : 'View'}
        </button>
      ),
    },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Approvals</div>
          <div className="page-sub">
            {isAdmin ? 'All payment requests · SOX audit trail on every action' : 'Your payment requests'}
          </div>
        </div>
        <button className="btn-primary" onClick={() => { setForm(EMPTY_FORM); setFiles([]); setFormError(null); setFormOpen(true) }}>
          + New Request
        </button>
      </div>

      {notice ? (
        <div className="status-bar" style={{ marginBottom: 12 }}>
          <span className="status-dot ok" />
          <span className="status-text">{notice}</span>
        </div>
      ) : null}
      {error ? (
        <div className="status-bar" style={{ marginBottom: 12 }}>
          <span className="status-dot warn" />
          <span className="status-text">{error}</span>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <select className="fsel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span style={{ color: 'var(--muted)', fontSize: '0.72rem', fontFamily: 'var(--mono)' }}>
          {visibleRows.length} request{visibleRows.length === 1 ? '' : 's'}
        </span>
      </div>

      {rows === null ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="empty" style={{ padding: 40, textAlign: 'center' }}>
          <div className="empty-icon">∅</div>
          <div>No requests yet. Click “+ New Request” to submit one for approval.</div>
        </div>
      ) : (
        <DataTable
          data={visibleRows as unknown as Record<string, unknown>[]}
          columns={columns as never}
          defaultSort={{ col: 'submittedAt', dir: 'desc' }}
          maxHeight="640px"
        />
      )}

      {/* ---------- New Request modal ---------- */}
      {formOpen ? (
        <div className="modal-overlay open" onClick={() => { if (!submitting) setFormOpen(false) }}>
          <div className="modal" style={{ width: 620, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-title">New payment request</span>
                <div className="modal-sub" style={{ marginTop: 4 }}>
                  Submitted requests go to an admin for approval. All actions are audit-logged.
                </div>
              </div>
              <button className="modal-close" onClick={() => { if (!submitting) setFormOpen(false) }} aria-label="Close">×</button>
            </div>
            <div className="modal-body" style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Vendor *</span>
                  <input className="fsearch" value={form.vendorName} onChange={(e) => setForm((p) => ({ ...p, vendorName: e.target.value }))} placeholder="e.g. Node40" />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Amount *</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="fsearch" style={{ flex: 1 }} type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
                    <select className="fsel" style={{ width: 90 }} value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}>
                      {['USD', 'USDC', 'EUR', 'GBP', 'MYR', 'AED'].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </label>
                <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Description</span>
                  <input className="fsearch" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="What is this payment for?" />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Invoice #</span>
                  <input className="fsearch" value={form.invoiceNumber} onChange={(e) => setForm((p) => ({ ...p, invoiceNumber: e.target.value }))} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Payment type</span>
                  <select className="fsel" value={form.paymentType} onChange={(e) => setForm((p) => ({ ...p, paymentType: e.target.value }))}>
                    {PAYMENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Invoice date</span>
                  <input className="fsearch" type="date" value={form.invoiceDate} onChange={(e) => setForm((p) => ({ ...p, invoiceDate: e.target.value }))} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Due date</span>
                  <input className="fsearch" type="date" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))} />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Entity</span>
                  <select className="fsel" value={form.entity} onChange={(e) => setForm((p) => ({ ...p, entity: e.target.value }))}>
                    <option value="">—</option>
                    {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Department</span>
                  <select className="fsel" value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}>
                    <option value="">—</option>
                    {BUDGET_DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>GL account (number or name, optional)</span>
                  <input className="fsearch" value={form.glAccount} onChange={(e) => setForm((p) => ({ ...p, glAccount: e.target.value }))} placeholder="e.g. 62010 Professional Services" />
                </label>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 6 }}>
                  Attachments (invoice PDF etc — up to 5 files, 4 MB each)
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.eml,.msg"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                />
                {files.length > 0 ? (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {files.map((f) => (
                      <li key={f.name}>{f.name} · {(f.size / 1024).toFixed(0)} KB</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {formError ? (
                <div style={{ marginTop: 14, padding: '8px 12px', background: 'rgba(217,48,37,0.1)', color: '#d93025', fontSize: '0.78rem', borderRadius: 4 }}>
                  {formError}
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button className="fsel" onClick={() => { if (!submitting) setFormOpen(false) }} disabled={submitting}>Cancel</button>
              <button
                className="fsel"
                onClick={() => void submitNewRequest()}
                disabled={submitting}
                style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }}
              >
                {submitting ? 'Submitting…' : 'Submit for approval'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------- Detail / Review modal ---------- */}
      {(detail || detailLoading) ? (
        <div className="modal-overlay open" onClick={() => { if (!actionBusy) closeDetail() }}>
          <div className="modal" style={{ width: 680, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-title">
                  {detail ? `${detail.request.refNumber} · ${detail.request.vendorName}` : 'Loading…'}
                </span>
                {detail ? (
                  <div className="modal-sub" style={{ marginTop: 4 }}>
                    Submitted {detail.request.submittedAt?.slice(0, 10)} by {detail.request.submitterEmail || 'unknown'}
                  </div>
                ) : null}
              </div>
              <button className="modal-close" onClick={() => { if (!actionBusy) closeDetail() }} aria-label="Close">×</button>
            </div>

            <div className="modal-body" style={{ padding: 20 }}>
              {detailLoading ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <Skeleton height={20} /><Skeleton height={20} /><Skeleton height={20} />
                </div>
              ) : detail ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', fontSize: '0.82rem' }}>
                    <Field label="Status">
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 999,
                        background: STATUS_STYLE[detail.request.status].bg,
                        color: STATUS_STYLE[detail.request.status].fg,
                        fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--mono)', textTransform: 'uppercase',
                      }}>{STATUS_STYLE[detail.request.status].label}</span>
                    </Field>
                    <Field label="Amount">
                      <strong style={{ fontFamily: 'var(--mono)' }}>
                        {detail.request.currency === 'USD'
                          ? fmtUSD(Number(detail.request.amount))
                          : `${Number(detail.request.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${detail.request.currency}`}
                      </strong>
                    </Field>
                    <Field label="Description">{detail.request.description || '—'}</Field>
                    <Field label="Payment type">{detail.request.paymentType || '—'}</Field>
                    <Field label="Invoice #">{detail.request.invoiceNumber || '—'}</Field>
                    <Field label="Invoice date">{detail.request.invoiceDate || '—'}</Field>
                    <Field label="Due date">{detail.request.dueDate || '—'}</Field>
                    <Field label="Entity">{detail.request.entity || '—'}</Field>
                    <Field label="Department">{detail.request.department || '—'}</Field>
                    <Field label="GL account">{detail.request.glAccount || '—'}</Field>
                    {detail.request.decidedAt ? (
                      <>
                        <Field label="Decided">{detail.request.decidedAt.slice(0, 16).replace('T', ' ')} UTC</Field>
                        <Field label="Decision note">{detail.request.decisionNote || '—'}</Field>
                      </>
                    ) : null}
                    {detail.request.paidAt ? (
                      <>
                        <Field label="Paid">{detail.request.paidAt.slice(0, 16).replace('T', ' ')} UTC</Field>
                        <Field label="Payment ref">{detail.request.paymentReference || '—'}</Field>
                      </>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Attachments
                    </div>
                    {detail.attachments.length === 0 ? (
                      <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>No attachments.</div>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                        {detail.attachments.map((a) => (
                          <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
                            <span>📎</span>
                            <a
                              href={`/api/approvals/${detail.request.id}/attachments/${a.id}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: 'var(--accent)', textDecoration: 'none' }}
                            >
                              {a.filename}
                            </a>
                            <span style={{ color: 'var(--muted)', fontSize: '0.68rem' }}>
                              {(a.sizeBytes / 1024).toFixed(0)} KB · sha256 {a.sha256.slice(0, 12)}…
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {detail.viewer.isAdmin ? (
                    <div style={{ marginTop: 18 }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        SOX audit trail
                      </div>
                      {auditEvents === null ? (
                        <div style={{ color: 'var(--muted)', fontSize: '0.74rem' }}>Loading trail…</div>
                      ) : auditEvents.length === 0 ? (
                        <div style={{ color: 'var(--muted)', fontSize: '0.74rem' }}>No events recorded.</div>
                      ) : (
                        <div style={{
                          border: '1px solid var(--border)', borderRadius: 6,
                          maxHeight: 220, overflowY: 'auto',
                          fontFamily: 'var(--mono)', fontSize: '0.68rem',
                        }}>
                          {auditEvents.map((ev, i) => {
                            const meta = ev.metadata ?? {}
                            const reviewS = fmtReviewMs((meta as { serverReviewMs?: unknown }).serverReviewMs)
                            const reviewC = fmtReviewMs((meta as { clientReviewMs?: unknown }).clientReviewMs)
                            const ip = (meta as { ip?: unknown }).ip
                            const ua = (meta as { userAgent?: unknown }).userAgent
                            const note = (meta as { note?: unknown }).note
                            const payRef = (meta as { paymentReference?: unknown }).paymentReference
                            const fname = (meta as { filename?: unknown }).filename
                            return (
                              <div key={ev.id} style={{
                                padding: '8px 12px',
                                borderBottom: i === auditEvents.length - 1 ? 'none' : '1px solid var(--border)',
                              }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                  <strong>{AUDIT_ACTION_LABELS[ev.action] ?? ev.action}</strong>
                                  <span style={{ color: 'var(--muted)' }}>{ev.at.slice(0, 19).replace('T', ' ')} UTC</span>
                                  <span style={{ color: 'var(--muted)' }}>· {ev.actorEmail ?? 'system'}</span>
                                </div>
                                <div style={{ color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                  {typeof ip === 'string' && ip ? <span>IP {ip}</span> : null}
                                  {reviewS ? <span>review {reviewS} (server)</span> : null}
                                  {reviewC && !reviewS ? <span>review {reviewC} (client-only ⚠)</span> : null}
                                  {typeof note === 'string' && note ? <span>note: “{note}”</span> : null}
                                  {typeof payRef === 'string' && payRef ? <span>ref: {payRef}</span> : null}
                                  {typeof fname === 'string' && fname ? <span>file: {fname}</span> : null}
                                </div>
                                {typeof ua === 'string' && ua ? (
                                  <div style={{ color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ua}>
                                    {ua}
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {detail.viewer.canDecide ? (
                    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Review decision
                      </div>
                      <textarea
                        className="fsearch"
                        style={{ width: '100%', minHeight: 60, resize: 'vertical' }}
                        placeholder="Note (required when rejecting — visible to the submitter)"
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                      />
                      <div style={{ fontSize: '0.66rem', color: 'var(--muted)', marginTop: 6 }}>
                        Your review time, IP, and device are recorded in the SOX audit trail.
                      </div>
                    </div>
                  ) : null}

                  {detail.viewer.canPay ? (
                    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Mark as paid
                      </div>
                      <input
                        className="fsearch"
                        style={{ width: '100%' }}
                        placeholder="Payment reference — tx hash / wire confirmation / Mercury ref"
                        value={paymentRef}
                        onChange={(e) => setPaymentRef(e.target.value)}
                      />
                    </div>
                  ) : null}

                  {detailError ? (
                    <div style={{ marginTop: 14, padding: '8px 12px', background: 'rgba(217,48,37,0.1)', color: '#d93025', fontSize: '0.78rem', borderRadius: 4 }}>
                      {detailError}
                    </div>
                  ) : null}
                </>
              ) : detailError ? (
                <div style={{ padding: '8px 12px', background: 'rgba(217,48,37,0.1)', color: '#d93025', fontSize: '0.78rem', borderRadius: 4 }}>
                  {detailError}
                </div>
              ) : null}
            </div>

            {detail ? (
              <div className="modal-footer">
                {detail.viewer.canCancel ? (
                  <button className="fsel" onClick={() => void cancelRequest()} disabled={actionBusy} style={{ color: '#d93025' }}>
                    Cancel request
                  </button>
                ) : null}
                <span style={{ flex: 1 }} />
                <button className="fsel" onClick={() => { if (!actionBusy) closeDetail() }} disabled={actionBusy}>Close</button>
                {detail.viewer.canDecide ? (
                  <>
                    <button
                      className="fsel"
                      onClick={() => void decide('rejected')}
                      disabled={actionBusy}
                      style={{ background: '#d93025', color: '#fff', borderColor: '#d93025', fontWeight: 600 }}
                    >
                      {actionBusy ? '…' : 'Reject'}
                    </button>
                    <button
                      className="fsel"
                      onClick={() => void decide('approved')}
                      disabled={actionBusy}
                      style={{ background: '#06D6A0', color: '#fff', borderColor: '#06D6A0', fontWeight: 600 }}
                    >
                      {actionBusy ? '…' : 'Approve'}
                    </button>
                  </>
                ) : null}
                {detail.viewer.canPay ? (
                  <button
                    className="fsel"
                    onClick={() => void markPaid()}
                    disabled={actionBusy}
                    style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }}
                  >
                    {actionBusy ? '…' : 'Mark paid'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.66rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}
