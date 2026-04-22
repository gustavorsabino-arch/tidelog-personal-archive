'use client'

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 16 }}>
      <div style={{ fontSize: '2rem', opacity: 0.3 }}>!</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--red)' }}>
        Something went wrong
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--muted)', maxWidth: 400, textAlign: 'center' }}>
        {error.message}
      </div>
      <button onClick={reset} className="btn-secondary" style={{ marginTop: 8 }}>
        Try again
      </button>
    </div>
  )
}
