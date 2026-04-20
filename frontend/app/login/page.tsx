'use client'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  async function signIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: 'orca.so' },
      },
    })
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--bg)',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          fontFamily: 'var(--mono)', fontSize: '1.8rem', fontWeight: 700,
          color: 'var(--accent)', marginBottom: 4,
        }}>
          tidelog
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 32 }}>
          finance dashboard
        </p>

        {error === 'domain' && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--red)', marginBottom: 16 }}>
            Access restricted to @orca.so accounts
          </p>
        )}
        {error === 'auth' && (
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--red)', marginBottom: 16 }}>
            Authentication failed. Please try again.
          </p>
        )}

        <button onClick={signIn} style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          fontFamily: 'var(--mono)', padding: '12px 24px', borderRadius: 8,
          background: 'var(--surface)', border: '1px solid var(--border2)',
          color: 'var(--text)', fontSize: '0.9rem', fontWeight: 500,
          cursor: 'pointer', transition: 'box-shadow 0.15s',
        }}>
          Sign in with Google
        </button>

        <p style={{
          fontFamily: 'var(--mono)', fontSize: '0.72rem',
          color: 'var(--muted2)', marginTop: 20,
        }}>
          Requires an @orca.so Google account
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
