'use client'
import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { isQboEntity } from '@/lib/qb/config'
import type { QbAccountLite } from '@/lib/qb/account-options'

export type QbAccount = QbAccountLite & { qbAccountId: string; accountType: string | null }
type AccountsResponse = { entity: string; accounts: QbAccount[] }

export function useQbAccounts(entity: string | null) {
  const enabled = !!entity && isQboEntity(entity)
  const key = enabled ? `/api/qb/accounts?entity=${encodeURIComponent(entity!)}` : null
  const { data, error, isLoading, mutate } = useSWR<AccountsResponse>(key)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!enabled) return
    setRefreshing(true); setRefreshError(null)
    try { await apiFetch(`/api/qb/accounts/refresh?entity=${encodeURIComponent(entity!)}`, { method: 'POST' }); await mutate() }
    catch (err) { setRefreshError(err instanceof Error ? err.message : 'Refresh failed') }
    finally { setRefreshing(false) }
  }, [enabled, entity, mutate])
  return { accounts: data?.accounts ?? [], isLoading: enabled && isLoading, error, refresh, refreshing, refreshError }
}
