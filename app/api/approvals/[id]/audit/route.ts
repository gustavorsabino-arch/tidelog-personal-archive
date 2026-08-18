import { NextRequest, NextResponse } from 'next/server'
import { asc, eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog, user } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'

export const runtime = 'nodejs'

/**
 * GET /api/approvals/[id]/audit — the SOX audit trail for one request.
 *
 * Admin-only (approvals:admin): the trail contains IPs, user-agents, and
 * review-time telemetry of OTHER users — submitters don't get to see that.
 * Reads the append-only audit_log (Postgres trigger rejects UPDATE/DELETE)
 * filtered to this request; chronological order.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { deny } = await requirePermission('approvals:admin', req)
  if (deny) return deny
  const { id } = await params

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      createdAt: auditLog.createdAt,
      metadata: auditLog.metadata,
      actorEmail: user.email,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.userId, user.id))
    .where(and(
      eq(auditLog.resourceType, 'approval_request'),
      eq(auditLog.resourceId, id),
    ))
    .orderBy(asc(auditLog.createdAt))
    .limit(500)

  return NextResponse.json({
    events: rows.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.createdAt.toISOString(),
      actorEmail: r.actorEmail,
      metadata: r.metadata,
    })),
  })
}
