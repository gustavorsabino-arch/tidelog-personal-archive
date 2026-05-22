'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { QboEntity } from '@/lib/qb/config'
import type { QbJournalEntry, QbJournalEntryLine } from '@/lib/qb/types'

type PreviewGroup = {
  kind: 'individual' | 'bulk'
  docNumberPreview: string
  memberTxIds: string[]
  je: QbJournalEntry
}

type PreviewResponse = {
  groups: PreviewGroup[]
  skipped: Array<{ txId: string; reason: string }>
}

type PostBatchResponse = {
  successes: Array<{
    postId: string
    docNumber: string
    qbJournalEntryId: string
    memberTxIds: string[]
  }>
  failures: Array<{
    docNumber: string
    error: string
    memberTxIds: string[]
  }>
  skipped: Array<{ txId: string; reason: string }>
}

type Props = {
  entity: QboEntity
  selectedTxIds: string[]
  open: boolean
  onClose: () => void
  // Called after a successful post (even on partial success — successes are real).
  // Parent should re-fetch transactions so the new badges show.
  onSuccess: () => void
}

// Sum debit and credit line amounts so the modal can render a "balanced" indicator.
// JE construction in T6 guarantees balance, but we display it defensively as a
// visual sanity check — if it ever shows ✗, we want to know before posting.
function checkBalance(lines: QbJournalEntryLine[]): { debits: number; credits: number; balanced: boolean } {
  let debits = 0
  let credits = 0
  for (const line of lines) {
    const amt = line.Amount
    if (line.JournalEntryLineDetail.PostingType === 'Debit') debits += amt
    else credits += amt
  }
  // Allow $0.01 floating-point fuzz — JE amounts are USD with 2 decimals, so any
  // difference larger than a penny is a real imbalance worth flagging.
  return { debits, credits, balanced: Math.abs(debits - credits) < 0.01 }
}

export function PostToQbModal({
  entity,
  selectedTxIds,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitResult, setSubmitResult] = useState<PostBatchResponse | null>(null)
  const [showFailureDetail, setShowFailureDetail] = useState(false)

  // Esc-to-close — only active while the modal is mounted. We don't suppress
  // close during submit; the request keeps running server-side either way, and
  // the warning banner already tells the user not to close the tab.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Fetch preview on open. We re-fetch every time `open` flips to true so a
  // close-then-reopen with a different selection picks up the new ids.
  useEffect(() => {
    if (!open) {
      // Reset transient state when closing so a re-open starts clean.
      setPreview(null)
      setPreviewError(null)
      setSubmitResult(null)
      setSubmitError(null)
      setShowFailureDetail(false)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    apiFetch<PreviewResponse>('/api/qb/post-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity, txIds: selectedTxIds }),
    })
      .then((res) => {
        if (cancelled) return
        setPreview(res)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setPreviewError(e instanceof Error ? e.message : 'Preview failed')
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, entity, selectedTxIds])

  const eligibleCount = preview?.groups.reduce((n, g) => n + g.memberTxIds.length, 0) ?? 0

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError(null)
    setSubmitResult(null)
    try {
      const res = await apiFetch<PostBatchResponse>('/api/qb/post-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity, txIds: selectedTxIds }),
      })
      setSubmitResult(res)
      // Even with partial failures, successes are real — refresh the parent so
      // posted rows render their badges. Parent decides whether to clear selection.
      onSuccess()
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Post failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={submitting ? undefined : onClose}>
      <div
        className="modal post-qb-modal"
        style={{ width: '720px', maxWidth: '96vw', maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-title">
              Post {selectedTxIds.length} selected to QuickBooks
            </div>
            <div className="modal-sub">
              Entity: {entity}
              {preview ? (
                <>
                  {' · '}
                  {preview.groups.length} journal entr{preview.groups.length === 1 ? 'y' : 'ies'}
                  {' · '}
                  {eligibleCount} eligible tx{eligibleCount === 1 ? '' : 's'}
                  {preview.skipped.length > 0 && (
                    <>
                      {' · '}
                      <span style={{ color: 'var(--warn, #d97706)' }}>
                        {preview.skipped.length} skipped
                      </span>
                    </>
                  )}
                </>
              ) : null}
            </div>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="modal-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Warning banner — always shown so the user can't miss it. */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid var(--warn, #d97706)',
              background: 'color-mix(in srgb, var(--warn, #d97706) 8%, transparent)',
              fontSize: '0.74rem',
              color: 'var(--text)',
            }}
          >
            <strong style={{ color: 'var(--warn, #d97706)' }}>⚠ Posting hits QuickBooks.</strong>
            {' '}Don&apos;t close this browser tab until complete.
          </div>

          {previewLoading && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: '0.78rem' }}>
              Loading preview…
            </div>
          )}

          {previewError && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid var(--red, #dc2626)',
                background: 'color-mix(in srgb, var(--red, #dc2626) 8%, transparent)',
                fontSize: '0.78rem',
                color: 'var(--red, #dc2626)',
              }}
            >
              Preview failed: {previewError}
            </div>
          )}

          {preview && (
            <>
              {preview.skipped.length > 0 && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid #f59e0b',
                    background: '#fef3c7',
                    fontSize: '0.74rem',
                    color: '#78350f',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6, color: '#92400e' }}>
                    ⊘ {preview.skipped.length} transaction{preview.skipped.length === 1 ? '' : 's'} will be skipped:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {preview.skipped.map((s) => (
                      <li key={s.txId} style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem' }}>
                        {s.txId.slice(0, 8)}…: {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.groups.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: '0.78rem' }}>
                  Nothing to post — all selected transactions are skipped.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {preview.groups.map((g, idx) => {
                    const bal = checkBalance(g.je.Line)
                    return (
                      <div
                        key={`${g.docNumberPreview}-${idx}`}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: 12,
                          background: 'var(--surface)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', fontWeight: 600 }}>
                              {g.docNumberPreview}
                            </span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              {g.kind === 'individual' ? 'Individual' : `Bulk (${g.memberTxIds.length} members)`}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontFamily: 'var(--mono)',
                              color: bal.balanced ? 'var(--green, #10b981)' : 'var(--red, #dc2626)',
                              fontWeight: 600,
                            }}
                            title={`Debits ${bal.debits.toFixed(2)} / Credits ${bal.credits.toFixed(2)}`}
                          >
                            {bal.balanced ? '✓ Balanced' : '✗ Unbalanced'}
                          </span>
                        </div>
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontFamily: 'var(--mono)',
                            fontSize: '0.7rem',
                          }}
                        >
                          <tbody>
                            {g.je.Line.map((line, li) => {
                              const isDebit = line.JournalEntryLineDetail.PostingType === 'Debit'
                              const acctRef = line.JournalEntryLineDetail.AccountRef
                              const vendor = line.JournalEntryLineDetail.Entity?.EntityRef.value
                              return (
                                <tr key={li} style={{ borderTop: li === 0 ? 'none' : '1px solid var(--border)' }}>
                                  <td
                                    style={{
                                      padding: '4px 8px 4px 0',
                                      color: isDebit ? 'var(--green, #10b981)' : 'var(--red, #dc2626)',
                                      fontWeight: 600,
                                      width: 60,
                                    }}
                                  >
                                    {isDebit ? 'Debit' : 'Credit'}
                                  </td>
                                  <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>
                                    {acctRef.value}
                                    {acctRef.name ? ` · ${acctRef.name}` : ''}
                                    {vendor ? <span style={{ marginLeft: 8, fontSize: '0.65rem', color: 'var(--accent)' }}>Vendor: {vendor}</span> : null}
                                  </td>
                                  <td style={{ padding: '4px 0 4px 8px', textAlign: 'right', fontWeight: 500 }}>
                                    ${line.Amount.toFixed(2)}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* Submit-side state — error or result summary. */}
          {submitError && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid var(--red, #dc2626)',
                background: 'color-mix(in srgb, var(--red, #dc2626) 8%, transparent)',
                fontSize: '0.78rem',
                color: 'var(--red, #dc2626)',
              }}
            >
              Post failed: {submitError}
            </div>
          )}

          {submitResult && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface2)',
                fontSize: '0.78rem',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--green, #10b981)', fontWeight: 600 }}>
                  ✓ {submitResult.successes.length} posted
                </span>
                {submitResult.failures.length > 0 && (
                  <span style={{ color: 'var(--red, #dc2626)', fontWeight: 600 }}>
                    ✗ {submitResult.failures.length} failed
                  </span>
                )}
                {submitResult.skipped.length > 0 && (
                  <span style={{ color: 'var(--warn, #d97706)', fontWeight: 600 }}>
                    ⊘ {submitResult.skipped.length} skipped
                  </span>
                )}
              </div>
              {submitResult.failures.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowFailureDetail((v) => !v)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                      textDecoration: 'underline',
                    }}
                  >
                    {showFailureDetail ? 'Hide' : 'Show'} failure details
                  </button>
                  {showFailureDetail && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.7rem', fontFamily: 'var(--mono)' }}>
                      {submitResult.failures.map((f, i) => (
                        <li key={i} style={{ color: 'var(--red, #dc2626)' }}>
                          {f.docNumber}: {f.error}
                          <span style={{ color: 'var(--muted)', marginLeft: 6 }}>
                            ({f.memberTxIds.length} tx{f.memberTxIds.length === 1 ? '' : 's'})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            className="fsel"
            onClick={onClose}
            disabled={submitting}
            style={{ cursor: submitting ? 'wait' : 'pointer' }}
          >
            {submitResult ? 'Close' : 'Cancel'}
          </button>
          {!submitResult && (
            <button
              className="fsel"
              onClick={handleSubmit}
              disabled={
                submitting ||
                previewLoading ||
                !!previewError ||
                !preview ||
                preview.groups.length === 0
              }
              style={{
                cursor: submitting ? 'wait' : 'pointer',
                background: 'var(--accent)',
                color: '#fff',
                borderColor: 'var(--accent)',
                opacity:
                  submitting || previewLoading || !!previewError || !preview || preview.groups.length === 0
                    ? 0.5
                    : 1,
              }}
            >
              {submitting ? 'Posting…' : 'Post to QuickBooks'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
