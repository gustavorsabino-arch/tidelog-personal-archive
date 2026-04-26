'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { AccessProvider, useSharedAccess } from '@/lib/access-context'
import { isBudgetOnlyUser, type AccessMeResponse } from '@/lib/access-model'

import { Sidebar } from './sidebar'

const NO_SIDEBAR_ROUTES = ['/login']

function LayoutShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { access, loading, error } = useSharedAccess()
  const showSidebar = !NO_SIDEBAR_ROUTES.includes(pathname)
  const shouldRedirectToBudget = isBudgetOnlyUser(access) && pathname !== '/budget'

  useEffect(() => {
    if (!loading && shouldRedirectToBudget) {
      router.replace('/budget')
    }
  }, [loading, router, shouldRedirectToBudget])

  if (!showSidebar) {
    return <>{children}</>
  }

  if (loading || shouldRedirectToBudget) {
    return (
      <div className="layout">
        <main className="content">
          <div className="status-bar">
            <span className={`status-dot ${loading ? 'loading' : 'warn'}`} />
            <span className="status-text">
              {loading ? 'Loading access…' : 'Redirecting to budget…'}
            </span>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="layout">
      {!error ? <Sidebar access={access} /> : null}
      <main className="content">{children}</main>
    </div>
  )
}

export function LayoutShell({
  children,
  initialAccess,
}: {
  children: React.ReactNode
  initialAccess?: AccessMeResponse | null
}) {
  return (
    <AccessProvider initialAccess={initialAccess}>
      <LayoutShellContent>{children}</LayoutShellContent>
    </AccessProvider>
  )
}
