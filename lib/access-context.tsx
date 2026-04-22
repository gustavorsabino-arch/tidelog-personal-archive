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

export function AccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccessMeResponse | null>(null)
  const [loading, setLoading] = useState(true)
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
    refresh()
  }, [])

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
