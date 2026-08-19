import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { applyApprovalsSchemaStatements } from '@/lib/db/approvals-schema'

/**
 * GET /api/admin/apply-approvals-migration
 *
 * Manual fallback for the approvals schema self-heal. The statements now
 * live in lib/db/approvals-schema.ts and are applied AUTOMATICALLY when a
 * fresh server instance boots (instrumentation.ts), so hitting this URL is
 * no longer part of the deploy routine — it remains as a diagnostic that
 * force-runs the full list and reports per-statement results.
 *
 * Every statement is idempotent (IF NOT EXISTS / duplicate_object
 * swallowing), so this is always safe to run. The FK-to-app.user
 * constraints fail with 'permission denied for table user' under the
 * runtime DB role — integrity hardening only, skipped and reported.
 *
 * Auth: admin:manage_data.
 */
export const maxDuration = 60

export async function GET(req: Request) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const startedAt = Date.now()
  const { applied, skipped } = await applyApprovalsSchemaStatements()

  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: skipped.length === 0
      ? 'admin.apply_approvals_migration.succeeded'
      : 'admin.apply_approvals_migration.partial',
    resourceType: 'migration',
    resourceId: 'approvals-schema',
    metadata: {
      byEmail: user.email,
      durationMs: Date.now() - startedAt,
      applied: applied.length,
      skipped,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    statementsApplied: applied.length,
    statementsSkipped: skipped,
    elapsedMs: Date.now() - startedAt,
    note: skipped.length === 0
      ? 'Everything applied. Reload /approvals.'
      : 'Tables + columns ready; skipped FK-to-user constraints are integrity hardening only (applied by a future credentialed db:migrate). The feature is fully functional. NOTE: since the boot-time self-heal shipped, running this manually is normally unnecessary.',
  })
}
