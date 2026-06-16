'use client'
import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { QBO_ENTITIES, isQboEntity } from '@/lib/qb/config'

type VendorsResponse = { vendors: { qbVendorId: string; displayName: string }[] }
type AllVendorsResponse = { vendors: { displayName: string }[] }

export function useQbVendors(entity: string | null) {
  const enabled = !!entity && isQboEntity(entity)
  const key = enabled ? `/api/qb/vendors?entity=${encodeURIComponent(entity!)}` : null
  const { data, error, isLoading, mutate } = useSWR<VendorsResponse>(key)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!enabled) return
    setRefreshing(true); setRefreshError(null)
    try { await apiFetch(`/api/qb/vendors/refresh?entity=${encodeURIComponent(entity!)}`, { method: 'POST' }); await mutate() }
    catch (err) { setRefreshError(err instanceof Error ? err.message : 'Refresh failed') }
    finally { setRefreshing(false) }
  }, [enabled, entity, mutate])
  return { vendors: data?.vendors ?? [], isLoading: enabled && isLoading, error, refresh, refreshing, refreshError }
}

export function useAllQbVendors() {
  const { data, error, isLoading, mutate } = useSWR<AllVendorsResponse>('/api/qb/vendors')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setRefreshing(true); setRefreshError(null)
    try {
      for (const e of QBO_ENTITIES) {
        await apiFetch(`/api/qb/vendors/refresh?entity=${encodeURIComponent(e)}`, { method: 'POST' })
      }
      await mutate()
    }
    catch (err) { setRefreshError(err instanceof Error ? err.message : 'Refresh failed') }
    finally { setRefreshing(false) }
  }, [mutate])
  return { vendors: data?.vendors ?? [], isLoading, error, refresh, refreshing, refreshError }
}
