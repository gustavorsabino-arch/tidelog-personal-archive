import { NextRequest, NextResponse } from 'next/server'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { approvalRequest, approvalAttachment, approvalAssignee, approvalDecision, user } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { hasPermission } from '@/lib/auth/permissions'
import { getSoxRequestContext } from '@/lib/approvals/request-context'
import {
  createApprovalRequest,
  FUNDING_NETWORKS,
  FUNDING_TOKENS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_REQUEST,
  PAYMENT_TYPES,
  type FundingNetwork,
  type FundingToken,
  type PaymentType,
} from '@/lib/approvals/service'

export const runtime = 'nodejs'
// Attachment uploads ride in the same request — allow time for a few MB
// over slow connections.
export const maxDuration = 60

/**
 * GET /api/approvals
 *   Admin (approvals:admin): every request.
 *   Submitter (approvals:submit): only their own.
 * Returns rows joined with submitter/decider display emails + attachment counts.
 */
export async function GET(req: NextRequest) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny

  const isAdmin = hasPermission(actor.role, 'approvals:admin')

  const rows = await db
    .select({
      request: approvalRequest,
      submitterEmail: user.email,
      attachmentCount: sql<number>`(
        SELECT count(*)::int FROM "app"."approval_attachment" a
        WHERE a."request_id" = ${approvalRequest.id}
      )`,
    })
    .from(approvalRequest)
    .leftJoin(user, eq(approvalRequest.submitterId, user.id))
    .where(isAdmin ? undefined : eq(approvalRequest.submitterId, actor.id))
    .orderBy(desc(approvalRequest.submittedAt))
    .limit(500)

  // Per-approver state for the Approvers column: assignee snapshot + votes,
  // grouped in memory (bounded by the 500-row cap above).
  const ids = rows.map((r) => r.request.id)
  const assigneeRows = ids.length > 0
    ? await db
        .select({
          requestId: approvalAssignee.requestId,
          userId: approvalAssignee.userId,
          email: approvalAssignee.email,
        })
        .from(approvalAssignee)
        .where(inArray(approvalAssignee.requestId, ids))
    : []
  const decisionRows = ids.length > 0
    ? await db
        .select({
          requestId: approvalDecision.requestId,
          approverId: approvalDecision.approverId,
          decision: approvalDecision.decision,
          note: approvalDecision.note,
          decidedAt: approvalDecision.decidedAt,
        })
        .from(approvalDecision)
        .where(inArray(approvalDecision.requestId, ids))
    : []

  const voteByKey = new Map(decisionRows.map((d) => [`${d.requestId}:${d.approverId}`, d]))
  const approversByRequest = new Map<string, { email: string; state: 'approved' | 'rejected' | 'pending'; note: string | null; decidedAt: Date | null }[]>()
  for (const a of assigneeRows) {
    const vote = voteByKey.get(`${a.requestId}:${a.userId}`)
    const list = approversByRequest.get(a.requestId) ?? []
    list.push({
      email: a.email,
      state: vote ? vote.decision : 'pending',
      note: vote?.note ?? null,
      decidedAt: vote?.decidedAt ?? null,
    })
    approversByRequest.set(a.requestId, list)
  }

  return NextResponse.json({
    requests: rows.map((r) => ({
      ...r.request,
      submitterEmail: r.submitterEmail,
      attachmentCount: r.attachmentCount,
      approvers: approversByRequest.get(r.request.id) ?? [],
    })),
    isAdmin,
  })
}

/**
 * POST /api/approvals — create a request. multipart/form-data:
 *   fields: vendorName, amount, currency, description?, invoiceNumber?,
 *           invoiceDate?, dueDate?, glAccount?, department?, entity?, paymentType?
 *   files:  attachments (0..5, each ≤ 4 MB)
 */
export async function POST(req: NextRequest) {
  const { user: actor, deny } = await requirePermission('approvals:submit', req)
  if (deny) return deny

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const str = (k: string): string | null => {
    const v = form.get(k)
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }

  const requestType = str('requestType') === 'funding' ? 'funding' as const : 'payment' as const

  const networkRaw = str('network')
  const network: FundingNetwork | null = networkRaw && (FUNDING_NETWORKS as readonly string[]).includes(networkRaw)
    ? networkRaw as FundingNetwork
    : null
  const tokenRaw = str('token')?.toUpperCase() ?? null
  const token: FundingToken | null = tokenRaw && (FUNDING_TOKENS as readonly string[]).includes(tokenRaw)
    ? tokenRaw as FundingToken
    : null
  const walletAddress = str('walletAddress')

  if (requestType === 'funding') {
    if (!network) return NextResponse.json({ error: 'network must be ethereum, solana, or tron' }, { status: 400 })
    if (!token) return NextResponse.json({ error: 'token must be one of USDC, USDT, ORCA, SOL, ETH' }, { status: 400 })
    if (!walletAddress) return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 })
    if (!str('description')) return NextResponse.json({ error: 'description is required for funding requests' }, { status: 400 })
  }

  // Fundings have no vendor — synthesize a readable label so the shared
  // NOT NULL column and the list view both stay meaningful.
  const vendorName = requestType === 'funding'
    ? `Wallet funding · ${token} on ${network}`
    : str('vendorName')
  if (!vendorName) return NextResponse.json({ error: 'vendorName is required' }, { status: 400 })
  const amountRaw = str('amount')
  const amount = amountRaw ? parseFloat(amountRaw) : NaN
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  const paymentTypeRaw = str('paymentType')
  const paymentType: PaymentType | null = paymentTypeRaw && (PAYMENT_TYPES as readonly string[]).includes(paymentTypeRaw)
    ? paymentTypeRaw as PaymentType
    : null

  const dateOk = (s: string | null) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s)
  const invoiceDate = str('invoiceDate')
  const dueDate = str('dueDate')
  if (!dateOk(invoiceDate) || !dateOk(dueDate)) {
    return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 })
  }

  const files = form.getAll('attachments').filter((v): v is File => v instanceof File)
  if (files.length > MAX_ATTACHMENTS_PER_REQUEST) {
    return NextResponse.json({ error: `Max ${MAX_ATTACHMENTS_PER_REQUEST} attachments` }, { status: 400 })
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

  try {
    const created = await createApprovalRequest(
      { id: actor.id, email: actor.email },
      {
        requestType,
        vendorName,
        description: str('description'),
        amount,
        currency: requestType === 'funding' ? (token ?? 'USD') : (str('currency') || 'USD'),
        invoiceNumber: str('invoiceNumber'),
        invoiceDate,
        dueDate,
        glAccount: str('glAccount'),
        department: str('department'),
        entity: str('entity'),
        paymentType: requestType === 'funding' ? 'crypto' : paymentType,
        network,
        token,
        walletAddress,
      },
      attachments,
      getSoxRequestContext(req),
    )
    return NextResponse.json({ ok: true, request: created }, { status: 201 })
  } catch (err) {
    const e = err as Error & { statusCode?: number }
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 })
  }
}
