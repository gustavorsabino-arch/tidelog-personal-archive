export const dynamic = 'force-static'

export default function PendingApprovalPage() {
  return (
    <main style={{ padding: 40, fontFamily: 'system-ui', maxWidth: 560 }}>
      <h1>Pending approval</h1>
      <p>Your account exists but no role has been assigned yet.</p>
      <p>Please contact an administrator to request access.</p>
    </main>
  )
}
