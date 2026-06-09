'use client'

// Bulk-JE drill-down side-panel.
//
// Opened from the transactions table when the user clicks a bulk DocNumber.
// Shows the member transactions that compose a single QB bulk journal entry,
// plus the same Re-post / Void / View-in-QB actions available per-row.
//
// Scope note (T12): we only show members that are present on the *current
// loaded page* — no extra API call. A future Wave 2d "load all members" fetch
// can replace `members` with a server query.

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { fmtUSD, fmtNum } from '@/lib/format'
import { qbJeUrl } from '@/lib/qb/links'
import type { QboEntity } from '@/lib/qb/config'
import type { Transaction } from '@/lib/types'

type Props = {
  open: boolean
  onClose: () => void
  entity: QboEntity
  docNumber: string
  postId: string
  qbJournalEntryId: string | null
  postingStatus: 'posted' | 'posted_modified' | 'posted_manually' | 'voided' | 'failed' | 'unposted' | null
  // All transactions currently loaded on the page that share this postId.
  // Caller filters by `t.qbPostId === postId` and passes the slice here so the
  // panel doesn't need to know about pagination.
  members: Transaction[]
  // True when the parent suspects there are members not on the current page
  // (e.g. the bulk has more rows than pageSize). Drives the "N members on
  // this page" footer note.
  membersPossiblyTruncated: boolean
  canPost: boolean
  // Triggered after a successful re-post or void so the parent can refresh.
  onMutated: () => void
}

const STATUS_LABEL: Record<NonNullable<Props['postingStatus']> | 'null', string> = {
  posted: 'Posted',
  posted_modified: 'Modified — needs re-post',
  posted_manually: 'Posted manually',
  voided: 'Voided',
  failed: 'Failed',
  unposted: 'Unposted',
  null: 'Unposted',
}

const STATUS_COLOR: Record<NonNullable<Props['postingStatus']> | 'null', string> = {
  posted: 'var(--green, #10b981)',
  posted_modified: 'var(--warn, #d97706)',
  posted_manually: 'var(--green, #10b981)',
  voided: 'var(--muted)',
  failed: 'var(--red, #dc2626)',
  unposted: 'var(--muted)',
  null: 'var(--muted)',
}

export function QbBulkDrilldownPanel({
  open,
  onClose,
  entity,
  docNumber,
  postId,
  qbJournalEntryId,
  postingStatus,
  members,
  membersPossiblyTruncated,
  canPost,
  onMutated,
}: Props) {
  const [busy, setBusy] = useState<null | 'repost' | 'void'>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Reset transient state whenever the panel reopens on a different post.
  useEffect(() => {
    if (!open) {
      setBusy(null)
      setActionError(null)
    }
  }, [open, postId])

  // Close on Escape — defer to native select/dropdown handling first.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (busy) return // don't close mid-action
      if (e.target instanceof HTMLSelectElement) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, busy])

  const totalUsd = useMemo(
    () => members.reduce((acc, t) => acc + (t.usd ?? 0), 0),
    [members],
  )

  const memberTxIds = useMemo(
    () => members.map((t) => t.id).filter((id): id is string => !!id),
    [members],
  )

  const statusKey = (postingStatus ?? 'null') as keyof typeof STATUS_LABEL
  const isVoided = postingStatus === 'voided'

  // Re-post: void current (unless already voided) then re-create with the
  // current member tx IDs. The server's post-batch is idempotent (D11) and
  // re-issues a fresh qb_post row, so members' post_id gets re-pointed.
  async function handleRepostAll() {
    if (!canPost) return
    if (memberTxIds.length === 0) {
      setActionError('No member transactions loaded on this page — cannot re-post.')
      return
    }
    const confirmMsg = isVoided
      ? `Re-post this voided bulk entry? A new QuickBooks journal entry will be created for ${memberTxIds.length} member${memberTxIds.length === 1 ? '' : 's'}.`
      : `Re-post this bulk entry? The current QuickBooks journal entry will be voided and a new one created for ${memberTxIds.length} member${memberTxIds.length === 1 ? '' : 's'}.`
    if (!window.confirm(confirmMsg)) return

    setBusy('repost')
    setActionError(null)
    try {
      if (!isVoided) {
        // Void first so the old DocNumber doesn't linger as a live JE in QB.
        await apiFetch('/api/qb/post-void', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ postId }),
        })
      }
      await apiFetch('/api/qb/post-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity, txIds: memberTxIds }),
      })
      onMutated()
      onClose()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Re-post failed')
    } finally {
      setBusy(null)
    }
  }

  async function handleVoid() {
    if (!canPost) return
    if (isVoided) return
    const confirmMsg = 'Void this QuickBooks journal entry? It will remain in QB with $0 amounts and a Voided flag. Member rows in tidelog return to unposted state but keep the link to the voided QB entry for audit.'
    if (!window.confirm(confirmMsg)) return

    setBusy('void')
    setActionError(null)
    try {
      await apiFetch('/api/qb/post-void', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId }),
      })
      onMutated()
      onClose()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Void failed')
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  const qbUrl = qbJeUrl(qbJournalEntryId, entity)

  return (
    <>
      <div
        onClick={busy ? undefined : onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Bulk journal entry ${docNumber}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(640px, 100vw)',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          zIndex: 101,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{
          padding: '16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: '0.9rem', fontWeight: 600,
                textDecoration: isVoided ? 'line-through' : 'none',
                color: isVoided ? 'var(--muted)' : 'var(--text)',
              }}>
                {docNumber}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>
                {members.length} transaction{members.length === 1 ? '' : 's'} on this page
                {' · '}
                <span style={{ fontFamily: 'var(--mono)' }}>{fmtUSD(totalUsd)}</span>
                {' · '}
                {entity}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" disabled={!!busy} style={{
              background: 'transparent', border: 'none', color: 'var(--text)',
              cursor: busy ? 'wait' : 'pointer', fontSize: '1.2rem', padding: 4,
            }}>×</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px',
              borderRadius: 4, background: 'var(--surface2)',
              color: STATUS_COLOR[statusKey],
              border: `1px solid ${STATUS_COLOR[statusKey]}`,
            }}>
              {STATUS_LABEL[statusKey]}
            </span>
            {membersPossiblyTruncated && (
              <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                Only members on the current page are shown.
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {canPost && (postingStatus === 'posted' || postingStatus === 'posted_modified' || postingStatus === 'voided') && (
              <button
                className="fsel"
                onClick={handleRepostAll}
                disabled={!!busy || memberTxIds.length === 0}
                title={memberTxIds.length === 0 ? 'No member transactions loaded on this page' : ''}
                style={{
                  cursor: busy ? 'wait' : memberTxIds.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: busy || memberTxIds.length === 0 ? 0.6 : 1,
                  fontSize: '0.72rem', fontWeight: 600,
                }}
              >
                {busy === 'repost' ? 'Re-posting…' : 'Re-post all'}
              </button>
            )}
            {canPost && (postingStatus === 'posted' || postingStatus === 'posted_modified') && (
              <button
                className="fsel"
                onClick={handleVoid}
                disabled={!!busy}
                style={{
                  cursor: busy ? 'wait' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  fontSize: '0.72rem', fontWeight: 600,
                }}
              >
                {busy === 'void' ? 'Voiding…' : 'Void'}
              </button>
            )}
            {qbUrl && (
              <a
                href={qbUrl}
                target="_blank"
                rel="noreferrer"
                className="fsel"
                style={{
                  fontSize: '0.72rem', textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center',
                }}
              >
                View in QB →
              </a>
            )}
          </div>
        </header>

        {actionError && (
          <div style={{
            padding: '8px 16px',
            background: 'color-mix(in srgb, var(--red, #dc2626) 8%, transparent)',
            color: 'var(--red, #dc2626)',
            borderBottom: '1px solid var(--border)',
            fontSize: '0.74rem',
          }}>
            {actionError}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {members.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: '0.8rem' }}>
              No member transactions loaded on the current page.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={th}>Tx</th>
                  <th style={th}>Token</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>USD</th>
                  <th style={th}>Date</th>
                </tr>
              </thead>
              <tbody>
                {members.map((t, i) => {
                  const d = new Date(t.date)
                  return (
                    <tr key={t.id ?? `${t.txHash}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={td}>
                        {t.txHash ? (
                          <a
                            href={`https://solscan.io/tx/${t.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', color: 'var(--accent)', textDecoration: 'none' }}
                            title={t.txHash}
                          >
                            {t.txHash.slice(0, 8)}…{t.txHash.slice(-4)}
                          </a>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td style={td}>{t.asset}</td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--mono)' }}>
                        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'}>
                          {t.dir === 'In' ? '+' : '-'}{fmtNum(t.qty, t.asset === 'SOL' ? 4 : 2)}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--mono)' }}>
                        {t.usd != null ? fmtUSD(t.usd) : '—'}
                      </td>
                      <td style={td}>
                        {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  )
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: '0.62rem',
  color: 'var(--muted)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
}

const td: React.CSSProperties = {
  padding: '6px 10px',
}
