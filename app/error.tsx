'use client'

// Keeps the page free of raw error messages in production (which can include
// DB schema/constraint details, third-party API internals, etc). The `digest`
// is a Next-generated server-error id, safe to show — it only references
// server logs.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isDev = process.env.NODE_ENV !== 'production'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 16 }}>
      <div style={{ fontSize: '2rem', opacity: 0.3 }}>!</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--red)' }}>
        Something went wrong
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--muted)', maxWidth: 400, textAlign: 'center' }}>
        {isDev ? error.message : (error.digest ? `Reference: ${error.digest}` : 'Please try again or contact an administrator.')}
      </div>
      <button onClick={reset} className="btn-secondary" style={{ marginTop: 8 }}>
        Try again
      </button>
    </div>
  )
}
