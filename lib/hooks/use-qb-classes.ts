'use client'
import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { QBO_ENTITIES, isQboEntity } from '@/lib/qb/config'

type ClassesResponse = { classes: { qbClassId: string; qbClassName: string }[] }
type AllClassesResponse = { classes: { qbClassName: string }[] }

export function useQbClasses(entity: string | null) {
  const enabled = !!entity && isQboEntity(entity)
  const key = enabled ? `/api/qb/classes?entity=${encodeURIComponent(entity!)}` : null
  const { data, error, isLoading, mutate } = useSWR<ClassesResponse>(key)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!enabled) return
    setRefreshing(true); setRefreshError(null)
    try { await apiFetch(`/api/qb/classes/refresh?entity=${encodeURIComponent(entity!)}`, { method: 'POST' }); await mutate() }
    catch (err) { setRefreshError(err instanceof Error ? err.message : 'Refresh failed') }
    finally { setRefreshing(false) }
  }, [enabled, entity, mutate])
  return { classes: data?.classes ?? [], isLoading: enabled && isLoading, error, refresh, refreshing, refreshError }
}

export function useAllQbClasses() {
  const { data, error, isLoading, mutate } = useSWR<AllClassesResponse>('/api/qb/classes')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setRefreshing(true); setRefreshError(null)
    try {
      for (const e of QBO_ENTITIES) {
        await apiFetch(`/api/qb/classes/refresh?entity=${encodeURIComponent(e)}`, { method: 'POST' })
      }
      await mutate()
    }
    catch (err) { setRefreshError(err instanceof Error ? err.message : 'Refresh failed') }
    finally { setRefreshing(false) }
  }, [mutate])
  return { classes: data?.classes ?? [], isLoading, error, refresh, refreshing, refreshError }
}
