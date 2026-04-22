import { db } from './db'
import { auditLog } from './db/schema/audit'

export type AuditEntry = {
  userId?: string | null
  action: string
  resourceType?: string
  resourceId?: string
  metadata?: Record<string, unknown>
}

/**
 * Write an entry to the append-only audit_log table.
 * Never throws to the caller — audit failures are logged to stderr but
 * must not break the request that triggered them.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: entry.userId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ?? {},
    })
  } catch (err) {
    console.error('[audit] failed to write entry', {
      action: entry.action,
      error: (err as Error).message,
    })
  }
}
