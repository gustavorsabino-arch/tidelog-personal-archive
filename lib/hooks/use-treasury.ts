'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import type { TreasuryOverview } from '@/lib/types'

export function useTreasury(entity?: string) {
  const [data, setData] = useState<TreasuryOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = entity ? `?entity=${entity}` : ''
      const result = await apiFetch<TreasuryOverview>(`/api/treasury/overview${params}`)
      setData(result)
      setError(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [entity])

  useEffect(() => { load() }, [load])

  return { data, loading, error, refresh: load }
}
