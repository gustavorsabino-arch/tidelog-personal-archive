'use client'
import { useMemo } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import type { Wallet } from '@/lib/types'

/**
 * Canonical SWR cache key for the wallet registry. Use this exact constant
 * when invalidating after wallet add/edit/delete:
 *
 *   import { mutate } from 'swr'
 *   import { WALLETS_KEY } from '@/lib/hooks/use-entity-wallets'
 *   await mutate(WALLETS_KEY)
 */
export const WALLETS_KEY = '/api/wallets'

export type WalletOption = { value: string; label: string }

export function useEntityWallets(entity: string): {
  options: WalletOption[]
  loading: boolean
} {
  const { data, isLoading } = useSWR<{ wallets: Wallet[] }>(
    WALLETS_KEY,
    apiFetch,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )

  // Memoized so consumers using `options` in useEffect deps don't re-run on
  // every parent render — the underlying SWR `data` reference is stable until
  // a refetch settles.
  const options = useMemo<WalletOption[]>(
    () =>
      (data?.wallets ?? [])
        .filter((w) => w.entity === entity)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((w) => ({ value: w.address, label: w.label })),
    [data, entity],
  )

  return { options, loading: isLoading }
}
