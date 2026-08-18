import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { approvalRequest, approvalAttachment } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { hasPermission } from '@/lib/auth/permissions'
import { logAudit } from '@/lib/audit'
import { getSoxRequestContext } from '@/lib/approvals/request-context'

export const runtime = 'nodejs'

/**
 * GET /api/approvals/[id]/attachments/[attachmentId] — download the stored
 * invoice file. Same visibility as the request (submitter or admin).
 * Every download is audit-logged with ip/user-agent — part of the SOX
 * "reviewer actually opened the document" evidence chain.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny
  const { id, attachmentId } = await params

  const [request] = await db
    .select({ id: approvalRequest.id, submitterId: approvalRequest.submitterId, refNumber: approvalRequest.refNumber })
    .from(approvalRequest)
    .where(eq(approvalRequest.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = hasPermission(actor.role, 'approvals:admin')
  if (!isAdmin && request.submitterId !== actor.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [att] = await db
    .select()
    .from(approvalAttachment)
    .where(and(eq(approvalAttachment.id, attachmentId), eq(approvalAttachment.requestId, id)))
    .limit(1)
  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ctx = getSoxRequestContext(req)
  await logAudit({
    userId: actor.id === 'dev-user' ? null : actor.id,
    action: 'approval.attachment_downloaded',
    resourceType: 'approval_request',
    resourceId: id,
    metadata: {
      refNumber: request.refNumber,
      byEmail: actor.email,
      attachmentId,
      filename: att.filename,
      sha256: att.sha256,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  })

  // att.data comes back from postgres-js as a Buffer/Uint8Array.
  const bytes = att.data as unknown as Uint8Array
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': att.contentType,
      'Content-Length': String(att.sizeBytes),
      'Content-Disposition': `attachment; filename="${att.filename.replace(/"/g, '')}"`,
      'X-Content-SHA256': att.sha256,
      'Cache-Control': 'private, no-store',
    },
  })
}
