export const dynamic = 'force-static'

export default function NoAccessPage() {
  return (
    <main style={{ padding: 40, fontFamily: 'system-ui', maxWidth: 560 }}>
      <h1>No access</h1>
      <p>Your email is not recognized by this application.</p>
      <p>If you believe this is an error, please contact an administrator.</p>
    </main>
  )
}
