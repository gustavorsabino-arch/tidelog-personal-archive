import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { hasPermission } from '@/lib/auth/permissions'
import { ensureApprovalsSchema } from '@/lib/db/approvals-schema'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import {
  addApprovalEvidence,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_REQUEST,
  type NewLinkInput,
} from '@/lib/approvals/service'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/approvals/[id]/evidence — add attachments and/or document links
 * to an existing request (forgotten invoices, receipts arriving after
 * payment, contracts already in Google Drive).
 *
 * multipart/form-data:
 *   attachments: 0..5 files (≤ 4 MB each; 10 lifetime per request)
 *   links: JSON array of { url, label? } (https only)
 *
 * Submitter or admin only; blocked on rejected/cancelled requests.
 * Audit-logged as approval.evidence_added.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny
  const { id } = await params

  await ensureApprovalsSchema().catch(() => {})

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const files = form.getAll('attachments').filter((v): v is File => v instanceof File)
  if (files.length > MAX_ATTACHMENTS_PER_REQUEST) {
    return NextResponse.json({ error: `Max ${MAX_ATTACHMENTS_PER_REQUEST} attachments per upload` }, { status: 400 })
  }
  const attachments = []
  for (const f of files) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: `${f.name} exceeds 4 MB` }, { status: 400 })
    }
    attachments.push({
      filename: f.name,
      contentType: f.type || 'application/octet-stream',
      bytes: Buffer.from(await f.arrayBuffer()),
    })
  }

  let links: NewLinkInput[] = []
  const linksRaw = form.get('links')
  if (typeof linksRaw === 'string' && linksRaw.trim()) {
    try {
      const parsed = JSON.parse(linksRaw)
      if (Array.isArray(parsed)) {
        links = parsed
          .filter((l): l is { url: string; label?: string } => !!l && typeof l.url === 'string')
          .map((l) => ({ url: l.url, label: typeof l.label === 'string' ? l.label : null }))
      }
    } catch {
      return NextResponse.json({ error: 'links must be a JSON array of { url, label? }' }, { status: 400 })
    }
  }

  try {
    const result = await addApprovalEvidence(
      { id: actor.id, email: actor.email },
      id,
      attachments,
      links,
      getSoxRequestContext(req),
      hasPermission(actor.role, 'approvals:admin'),
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 })
  }
}
