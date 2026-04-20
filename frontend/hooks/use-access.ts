'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { apiFetch } from '@/lib/api'
import type { AccessMeResponse } from '@/lib/access-model'
import { normalizeEmail } from '@/lib/access-model'
import { buildAccessRealtimeSubscriptionSpecs } from '@/lib/access-live'
import { shouldRefreshAccessForAuthEvent } from '@/lib/access-refresh'
import { createClient } from '@/lib/supabase/client'

type UseAccessOptions = {
  year?: number | null
}

export function useAccess(options: UseAccessOptions = {}) {
  const supabase = useMemo(() => createClient(), [])
  const [access, setAccess] = useState<AccessMeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoadedOnceRef = useRef(false)
  const authEmailRef = useRef<string | null>(null)

  const refresh = useCallback(() => {
    setRefreshNonce((current) => current + 1)
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      refresh()
    }, 100)
  }, [refresh])

  const realtimeSpecs = useMemo(
    () => buildAccessRealtimeSubscriptionSpecs(authEmail, access, options.year),
    [access?.canonicalEmail, access?.email, authEmail, options.year],
  )

  useEffect(() => {
    let active = true

    async function loadAuthEmail() {
      const { data, error: authError } = await supabase.auth.getUser()
      if (!active || authError) return
      const nextAuthEmail = data.user?.email ? normalizeEmail(data.user.email) : null
      authEmailRef.current = nextAuthEmail
      setAuthEmail(nextAuthEmail)
    }

    void loadAuthEmail()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextAuthEmail = session?.user?.email ? normalizeEmail(session.user.email) : null
      const previousAuthEmail = authEmailRef.current

      authEmailRef.current = nextAuthEmail
      setAuthEmail(nextAuthEmail)

      if (shouldRefreshAccessForAuthEvent(event, previousAuthEmail, nextAuthEmail)) {
        refresh()
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [refresh, supabase])

  useEffect(() => {
    let cancelled = false

    async function loadAccess() {
      if (hasLoadedOnceRef.current) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const params = new URLSearchParams()
        if (Number.isFinite(options.year)) {
          params.set('year', String(options.year))
        }

        const nextAccess = await apiFetch<AccessMeResponse>(
          `/api/access/me${params.size > 0 ? `?${params.toString()}` : ''}`,
          { cache: 'no-store' },
        )

        if (!cancelled) {
          setAccess(nextAccess)
          setError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setAccess(null)
          setError(loadError instanceof Error ? loadError.message : 'Failed to load access.')
        }
      } finally {
        if (!cancelled) {
          hasLoadedOnceRef.current = true
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void loadAccess()

    return () => {
      cancelled = true
    }
  }, [options.year, refreshNonce])

  useEffect(() => {
    if (realtimeSpecs.length === 0) return undefined

    const channelName = [
      'access-live',
      authEmail ?? 'anonymous',
      access?.canonicalEmail ?? 'uncanonicalized',
      Number.isFinite(options.year) ? String(options.year) : 'all-years',
    ].join(':')

    const channel = supabase.channel(channelName)

    for (const spec of realtimeSpecs) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: spec.table,
          ...(spec.filter ? { filter: spec.filter } : {}),
        },
        () => {
          scheduleRefresh()
        },
      )
    }

    channel.subscribe()

    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }

      void supabase.removeChannel(channel)
    }
  }, [
    access?.canonicalEmail,
    authEmail,
    realtimeSpecs,
    scheduleRefresh,
    supabase,
  ])

  return { access, loading, refreshing, error, refresh }
}
