'use client'
import { useMemo } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { groupMonthsByYear } from '@/lib/format'

export function gainLossMonthsKey(entity: string): string {
  return `/api/treasury/gain-loss/months?entity=${encodeURIComponent(entity)}`
}

export function useGainLossMonths(entity: string): {
  years: string[]
  byYear: Record<string, string[]>
  loading: boolean
} {
  const { data, isLoading } = useSWR<{ months: string[] }>(
    entity ? gainLossMonthsKey(entity) : null,
    apiFetch,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  const grouped = useMemo(() => groupMonthsByYear(data?.months ?? []), [data])
  return { years: grouped.years, byYear: grouped.byYear, loading: isLoading }
}
