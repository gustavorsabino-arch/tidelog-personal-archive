'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './sidebar'
import type { AccessMeResponse } from '@/lib/access-model'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/treasury-management': 'Treasury Mgmt',
  '/transactions': 'Transactions',
  '/gain-loss': 'Gain / Loss',
  '/unrealized': 'Unrealized',
  '/orca-ledger': 'ORCA Ledger',
  '/accounting': 'Balance Sheet',
  '/pnl': 'P&L',
  '/budget': 'Budget',
  '/wallets': 'Wallets',
  '/admin': 'Access Control',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  // Fallback: longest matching prefix
  const match = Object.keys(PAGE_TITLES)
    .filter((href) => href !== '/' && pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0]
  return match ? PAGE_TITLES[match] : 'Tidelog'
}

export function MobileTopBar({ access }: { access: AccessMeResponse | null }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Close drawer whenever the route changes (so tapping a nav link auto-closes).
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Lock body scroll while drawer is open.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  return (
    <>
      <header className="mobile-top-bar">
        <button
          type="button"
          className="mobile-top-bar-toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="mobile-top-bar-toggle-line" />
          <span className="mobile-top-bar-toggle-line" />
          <span className="mobile-top-bar-toggle-line" />
        </button>
        <span className="mobile-top-bar-title">{getPageTitle(pathname)}</span>
      </header>

      {open ? (
        <div className="mobile-drawer-root" role="dialog" aria-modal="true">
          <button
            type="button"
            className="mobile-drawer-backdrop"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="mobile-drawer-panel">
            <Sidebar access={access} />
          </div>
        </div>
      ) : null}
    </>
  )
}
