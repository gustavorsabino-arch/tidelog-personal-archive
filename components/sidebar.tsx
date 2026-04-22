'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

import { getAllowedPages, type AccessMeResponse } from '@/lib/access-model'

const NAV_ITEMS = [
  { href: '/', label: 'Overview', color: '#06D6A0', section: 'Views', pageKey: 'overview' },
  { href: '/treasury-management', label: 'On-Chain Treasury Mgmt', color: '#118AB2', section: 'Views', pageKey: 'treasury-management' },
  { href: '/transactions', label: 'Transactions', color: '#2775ca', section: 'Views', pageKey: 'transactions' },
  { href: '/gain-loss', label: 'Gain / Loss', color: '#D4A017', section: 'Views', pageKey: 'gain-loss' },
  { href: '/unrealized', label: 'Unrealized', color: '#9945ff', section: 'Views', pageKey: 'unrealized' },
  { href: '/orca-ledger', label: 'ORCA Ledger', color: '#00A8A8', section: 'Views', pageKey: 'orca-ledger' },
  { href: '/accounting', label: 'Balance Sheet', color: '#D4A017', section: 'Views', pageKey: 'accounting' },
  { href: '/pnl', label: 'P&L', color: '#06D6A0', section: 'Views', pageKey: 'pnl' },
  { href: '/budget', label: 'Budget', color: '#D4A017', section: 'Views', pageKey: 'budget' },
  { href: '/wallets', label: 'Wallets', color: '#888888', section: 'Config', pageKey: 'wallets' },
  { href: '/admin', label: 'Access Control', color: '#d93025', section: 'Config', pageKey: 'admin' },
]

function getVisibleNavItems(access: AccessMeResponse | null) {
  const allowedPages = getAllowedPages(access)
  if (allowedPages === null) return NAV_ITEMS
  return NAV_ITEMS.filter((item) => allowedPages.includes(item.pageKey))
}

function renderNavItem(item: typeof NAV_ITEMS[number], pathname: string) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)

  return (
    <Link
      key={item.href}
      href={item.href}
      className={`sb-item${active ? ' active' : ''}`}
      style={{ '--dot-glow': `${item.color}33` } as React.CSSProperties}
    >
      <span className="sb-dot" style={{ background: item.color }} />
      {item.label}
    </Link>
  )
}

export function Sidebar({ access }: { access: AccessMeResponse | null }) {
  const pathname = usePathname()
  const visibleItems = getVisibleNavItems(access)
  const viewItems = visibleItems.filter((item) => item.section === 'Views')
  const configItems = visibleItems.filter((item) => item.section === 'Config')

  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <div className="sb-logo-text">tidelog</div>
        <div className="sb-logo-sub">finance dashboard</div>
      </div>

      {viewItems.length > 0 ? (
        <>
          <div className="sb-section">Views</div>
          {viewItems.map((item) => renderNavItem(item, pathname))}
        </>
      ) : null}

      {viewItems.length > 0 && configItems.length > 0 ? <div className="sb-sep" /> : null}
      {configItems.length > 0 ? (
        <>
          <div className="sb-section">Config</div>
          {configItems.map((item) => renderNavItem(item, pathname))}
        </>
      ) : null}

      <div className="sb-bottom">
        <button
          type="button"
          onClick={() => {
            authClient.signOut({
              fetchOptions: { onSuccess: () => { window.location.href = '/login' } },
            })
          }}
          className="sb-item"
          style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}
        >
          <span className="sb-dot" style={{ background: '#888888' }} />
          Sign out
        </button>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'var(--muted2)', marginTop: 8 }}>v2.0</div>
      </div>
    </aside>
  )
}
