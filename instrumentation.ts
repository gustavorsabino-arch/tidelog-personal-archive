/**
 * Next.js instrumentation — runs once when a fresh server instance boots
 * (on Vercel: every function cold start), BEFORE it serves requests.
 *
 * Self-heals the approvals schema: after a deploy that added columns or
 * tables, the first instance to boot applies the pending (idempotent)
 * statements automatically, so nobody has to remember to open
 * /api/admin/apply-approvals-migration. When the DB is already current the
 * cost is a single information_schema probe.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureApprovalsSchema } = await import('@/lib/db/approvals-schema')
    await ensureApprovalsSchema().catch(() => {
      // Already logged inside; never block boot.
    })
  }
}
