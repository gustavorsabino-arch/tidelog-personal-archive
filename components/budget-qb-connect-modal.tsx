'use client'

import { useEffect } from 'react'

import type { QboConnectionStatus } from '@/lib/qb/types'
import { ForceRefreshPanel } from './force-refresh-panel'

type BudgetQbConnectModalProps = {
  open: boolean
  statuses: readonly QboConnectionStatus[]
  loading: boolean
  canConnect: boolean
  onClose: () => void
  onRefresh: () => void
  onConnect: (entity: QboConnectionStatus['entity']) => void
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return 'Not connected'
  return new Date(value).toLocaleString()
}

export function BudgetQbConnectModal({
  open,
  statuses,
  loading,
  canConnect,
  onClose,
  onRefresh,
  onConnect,
}: BudgetQbConnectModalProps) {
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal budget-qb-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">QuickBooks</div>
            <div className="modal-sub">Manage entity connections and refresh cached data.</div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close QuickBooks modal">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="budget-import-guidance" style={{ marginBottom: 16 }}>
            <span className="budget-section-note">Connect each entity once to enable QuickBooks actuals.</span>
            <span className="budget-section-note">Current page fetches require all entities for the `All Entities` budget view.</span>
          </div>

          {loading ? (
            <div className="status-bar">
              <span className="status-dot loading" />
              <span className="status-text">Loading QuickBooks status…</span>
            </div>
          ) : (
            <div className="budget-qb-status-list">
              {statuses.map((status) => (
                <div key={status.entity} className="budget-qb-status-row">
                  <div>
                    <div className="budget-qb-status-entity">{status.entity}</div>
                    <div className="budget-section-note">
                      {status.connected ? `Updated ${formatUpdatedAt(status.updatedAt)}` : 'Not connected yet'}
                    </div>
                  </div>

                  <div className="budget-qb-status-actions">
                    <span className={`budget-history-badge${status.connected ? ' ok' : ''}`}>
                      {status.connected ? 'Connected' : 'Missing'}
                    </span>
                    {canConnect ? (
                      <button
                        type="button"
                        className="btn-secondary budget-qb-connect-btn"
                        onClick={() => onConnect(status.entity)}
                      >
                        {status.connected ? 'Reconnect' : 'Connect'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="budget-qb-modal-actions">
            <button type="button" className="btn-secondary" onClick={onRefresh}>
              Refresh Status
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>

          {canConnect ? (
            <>
              <hr style={{ margin: '24px 0', border: 0, borderTop: '1px solid var(--border)' }} />
              <ForceRefreshPanel refreshKey={open} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
