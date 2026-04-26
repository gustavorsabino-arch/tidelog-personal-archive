'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AccessMeResponse } from './access-model'

type AccessContextValue = {
  access: AccessMeResponse | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const AccessContext = createContext<AccessContextValue | null>(null)

async function fetchMe(): Promise<AccessMeResponse | null> {
  const res = await fetch('/api/me', { credentials: 'same-origin' })
  if (res.status === 401) return null
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function AccessProvider({
  children,
  initialAccess,
}: {
  children: ReactNode
  // When the root server layout has already resolved the user from x-user-*
  // headers, pass it here. The provider seeds state from it and skips the
  // mount-time /api/me fetch — the client paints with access in hand.
  initialAccess?: AccessMeResponse | null
}) {
  const seeded = initialAccess !== undefined
  const [access, setAccess] = useState<AccessMeResponse | null>(seeded ? initialAccess : null)
  const [loading, setLoading] = useState(!seeded)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchMe()
      setAccess(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (seeded) return
    refresh()
  }, [seeded])

  return (
    <AccessContext.Provider value={{ access, loading, error, refresh }}>
      {children}
    </AccessContext.Provider>
  )
}

export function useSharedAccess(): AccessContextValue {
  const ctx = useContext(AccessContext)
  if (!ctx) {
    throw new Error('useSharedAccess must be used inside <AccessProvider>')
  }
  return ctx
}
