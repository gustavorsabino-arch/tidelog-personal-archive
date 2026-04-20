'use client'
import { ENTITIES, ENTITY_COLORS } from '@/lib/constants'
import { useState } from 'react'

export default function PnLPage() {
  const [entity, setEntity] = useState('Opco')

  return (
    <div>
      <div className="page-header">
        <div className="page-title">P&amp;L</div>
        <div className="page-sub">Profit &amp; Loss statements from QuickBooks</div>
      </div>
      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map(e => (
            <button key={e} className={`entity-tab${entity === e ? ' active' : ''}`} onClick={() => setEntity(e)}
              style={entity === e ? { color: ENTITY_COLORS[e] } : undefined}>
              {e}
            </button>
          ))}
        </div>
      </div>
      <div className="empty">
        <div className="empty-icon">💰</div>
        <div>P&amp;L — pulls profit &amp; loss reports from QuickBooks.</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>Requires QB connection for each entity.</div>
      </div>
    </div>
  )
}
