'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth/client'

export function LoginButton({ callbackURL }: { callbackURL: string }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onClick = async () => {
    setLoading(true)
    setErr(null)
    try {
      // better-auth's client returns { data, error } and does NOT throw on
      // HTTP errors. Without checking `error` here, a 5xx (e.g. DB down)
      // leaves the button stuck in "Signing in…" forever.
      const res = await authClient.signIn.social({ provider: 'google', callbackURL })
      if (res?.error) {
        setErr(res.error.message ?? `Sign-in failed (${res.error.status ?? 'unknown error'})`)
        setLoading(false)
      }
    } catch (e) {
      setErr((e as Error).message)
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        style={{
          padding: '12px 20px',
          fontFamily: 'var(--sans)',
          fontSize: '1rem',
          border: '1px solid var(--muted2, #888)',
          background: 'white',
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? 'Signing in\u2026' : 'Sign in with Google'}
      </button>
      {err ? <p style={{ color: '#d93025', marginTop: 12 }}>{err}</p> : null}
    </div>
  )
}
