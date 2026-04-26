'use client'

import { SWRConfig } from 'swr'
import { apiFetch } from '@/lib/api'

// One central place for SWR defaults. Per-page useSWR calls inherit these
// unless they override individual options.
//
// keepPreviousData: when the SWR key changes (filter / period switch), keep
// the previous result visible while the new one loads — avoids skeleton flash.
// dedupingInterval: 30s suits this app's data freshness; treasury/pnl/etc.
// don't need sub-30s refetches.
// revalidateOnFocus: off — the cron + manual refresh paths cover freshness.
export function SwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (key: string) => apiFetch(key),
        revalidateOnFocus: false,
        dedupingInterval: 30_000,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  )
}
