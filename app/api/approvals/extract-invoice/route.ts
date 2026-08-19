import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import { MAX_ATTACHMENT_BYTES } from '@/lib/approvals/service'
import { extractInvoiceFields, invoiceExtractionEnabled } from '@/lib/approvals/invoice-extract'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * POST /api/approvals/extract-invoice — read an uploaded invoice (PDF or
 * image) with Claude and return prefill fields for the payment form.
 * multipart/form-data with a single `file`.
 *
 * The extraction is a DRAFT: nothing is stored here; the submitter reviews
 * every field before submitting. Audit-logged so trail readers can see a
 * prefill happened.
 */
export async function POST(req: NextRequest) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny

  if (!invoiceExtractionEnabled()) {
    return NextResponse.json(
      { error: 'Invoice extraction is not configured yet (ANTHROPIC_API_KEY missing)' },
      { status: 503 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: `${file.name} exceeds 4 MB` }, { status: 400 })
  }
  const contentType = file.type || 'application/pdf'
  if (contentType !== 'application/pdf' && !contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'Only PDF or image invoices can be read' }, { status: 400 })
  }

  try {
    const fields = await extractInvoiceFields(Buffer.from(await file.arrayBuffer()), contentType)

    const ctx = getSoxRequestContext(req)
    await logAudit({
      userId: actor.id === 'dev-user' ? null : actor.id,
      action: 'approval.invoice_extracted',
      resourceType: 'approval_request',
      metadata: {
        byEmail: actor.email,
        filename: file.name,
        extracted: fields,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    }).catch(() => {})

    return NextResponse.json({ ok: true, fields })
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    console.error('[invoice-extract] failed:', e.message)
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 })
  }
}
