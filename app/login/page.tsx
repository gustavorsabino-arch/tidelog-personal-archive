import { redirect } from 'next/navigation'
import { readAuthMode } from '@/lib/auth/startup-check'
import { LoginButton } from './login-button'

const ERROR_MESSAGES: Record<string, string> = {
  unknown_email: 'Your email is not authorized. Please contact an administrator.',
  access_denied: 'Sign-in was cancelled.',
  invalid_grant: 'Sign-in failed. Try again.',
}

function sanitizeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (!v) return '/'
  // Internal-only: must start with single slash.
  if (!v.startsWith('/')) return '/'
  if (v.startsWith('//') || v.startsWith('/\\')) return '/'
  return v
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  if (readAuthMode() === 'cf-access') {
    redirect('/')
  }

  const sp = await searchParams
  const callbackURL = sanitizeNext(sp.next)
  const errorMessage = sp.error ? (ERROR_MESSAGES[sp.error] ?? 'Sign-in failed.') : null

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 24,
      padding: 40,
      fontFamily: 'var(--sans)',
    }}>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: '1.5rem', margin: 0 }}>tidelog</h1>
      {errorMessage ? (
        <div style={{
          padding: 12,
          border: '1px solid #d93025',
          background: '#fde7e6',
          color: '#a50e0e',
          maxWidth: 400,
        }}>
          {errorMessage}
        </div>
      ) : null}
      <LoginButton callbackURL={callbackURL} />
    </main>
  )
}
