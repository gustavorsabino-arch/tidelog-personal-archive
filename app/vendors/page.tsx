'use client'

import { useState } from 'react'
import VendorsMaster from '@/components/vendor-master'
import AppsCatalog from '@/components/apps-catalog'

export default function VendorsAppsPage() {
  const [tab, setTab] = useState<'vendors' | 'apps'>('vendors')
  return (
    <div>
      <div className="page-header"><div><div className="page-title">Vendors / Apps</div></div></div>
      <div role="tablist" aria-label="Vendors / Apps" style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {(['vendors', 'apps'] as const).map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name}
            onClick={() => setTab(name)}
            style={{ padding: '10px 18px', border: 0, borderBottom: tab === name ? '2px solid var(--accent)' : '2px solid transparent', background: 'transparent', color: tab === name ? 'var(--text)' : 'var(--muted)', fontWeight: tab === name ? 700 : 500, cursor: 'pointer' }}>
            {name === 'vendors' ? 'Vendors' : 'Apps'}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === 'vendors' ? <VendorsMaster /> : <AppsCatalog />}</div>
    </div>
  )
}
