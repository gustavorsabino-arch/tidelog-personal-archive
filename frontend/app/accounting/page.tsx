'use client'
import { ENTITIES, ENTITY_COLORS } from '@/lib/constants'
import { useState } from 'react'

export default function AccountingPage() {
  const [entity, setEntity] = useState('Opco')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Balance Sheet</div>
        <div className="page-sub">On-chain balances and GL account sync</div>
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
        <select className="fsel" value={year} onChange={e => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="fsel" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString('en', { month: 'short' })}</option>
          ))}
        </select>
      </div>
      <div className="empty">
        <div className="empty-icon">📋</div>
        <div>Balance sheet — on-chain balances + GL sync from QuickBooks.</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>Requires QB connection and cached balance data.</div>
      </div>
    </div>
  )
}
