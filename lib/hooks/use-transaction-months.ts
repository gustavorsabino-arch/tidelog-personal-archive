'use client'
import { useMemo } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { groupMonthsByYear } from '@/lib/format'

/**
 * Canonical key builder for the months endpoint. Use this when calling
 * `mutate(...)` so consumers and mutators share the exact same cache key.
 */
export function transactionMonthsKey(entity: string, asset?: string): string {
  const params = new URLSearchParams({ entity })
  if (asset) params.set('asset', asset)
  return `/api/treasury/transactions/months?${params.toString()}`
}

export function useTransactionMonths(entity: string, asset?: string): {
  years: string[]
  byYear: Record<string, string[]>
  loading: boolean
} {
  const { data, isLoading } = useSWR<{ months: string[] }>(
    entity ? transactionMonthsKey(entity, asset) : null,
    apiFetch,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )

  // Memoize so consumers using `years`/`byYear` in useEffect deps don't
  // retrigger on every parent render — SWR's `data` is stable until a refetch.
  const grouped = useMemo(() => groupMonthsByYear(data?.months ?? []), [data])
  return { years: grouped.years, byYear: grouped.byYear, loading: isLoading }
}
