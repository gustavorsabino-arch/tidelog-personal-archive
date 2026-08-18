'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { AccessProvider, useSharedAccess } from '@/lib/access-context'
import { isBudgetOnlyUser, type AccessMeResponse } from '@/lib/access-model'

import { Sidebar } from './sidebar'
import { MobileTopBar } from './mobile-top-bar'

const NO_SIDEBAR_ROUTES = ['/login']

function LayoutShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { access, loading, error } = useSharedAccess()
  const showSidebar = !NO_SIDEBAR_ROUTES.includes(pathname)
  // budget_viewer users may reach /budget AND /approvals (submitters in the
  // approval workflow); everything else redirects to /budget.
  const budgetViewerAllowed = pathname === '/budget' || pathname.startsWith('/approvals')
  const shouldRedirectToBudget = isBudgetOnlyUser(access) && !budgetViewerAllowed

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
      {!error ? <MobileTopBar access={access} /> : null}
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
