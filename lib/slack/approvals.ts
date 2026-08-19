import 'server-only'

/**
 * Slack notifications for the Approvals workflow.
 *
 * One status card per request, posted to the approvals channel at
 * submission; every status change chat.updates the SAME message (Pending →
 * Approved → Paid / Rejected / Cancelled) and drops a detail line in the
 * card's thread ("kate approved (1/2)", "rejected by isaac: …").
 *
 * Design rules:
 *  - Fire-safe: every export swallows its own errors and applies a short
 *    timeout. A Slack outage must NEVER fail or noticeably slow a SOX
 *    action — the audit_log is the source of truth, Slack is a mirror.
 *  - Dormant without config: if SLACK_BOT_TOKEN is absent every call is a
 *    silent no-op, so local/dev environments never touch Slack.
 */

const TOKEN = process.env.SLACK_BOT_TOKEN
// Channel id is not a secret; default to the #payment-approvals channel so
// only the token needs to be configured.
const CHANNEL = process.env.SLACK_APPROVALS_CHANNEL || 'C0BR3KPC9C3'
const TIMEOUT_MS = 4000

export function slackEnabled(): boolean {
  return !!TOKEN
}

async function slackCall(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!TOKEN) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body = await res.json() as Record<string, unknown>
    if (!body.ok) {
      console.error(`[slack] ${method} failed:`, body.error)
      return null
    }
    return body
  } catch (err) {
    console.error(`[slack] ${method} error:`, (err as Error).message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type SlackCardRequest = {
  refNumber: string
  status: string
  requestType: string
  vendorName: string
  description: string | null
  amount: string | number
  currency: string
  department: string | null
  entity: string | null
  network: string | null
  token: string | null
  walletAddress: string | null
  submitterEmail: string
}

const STATUS_LINE: Record<string, string> = {
  pending: '🟡 *PENDING*',
  approved: '✅ *APPROVED* — ready to pay',
  rejected: '❌ *REJECTED*',
  paid: '💸 *PAID*',
  cancelled: '⚪ *CANCELLED*',
}

function fmtAmount(amount: string | number, currency: string): string {
  const n = Number(amount)
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'USD' ? `$${formatted}` : `${formatted} ${currency}`
}

function shortEmail(email: string): string {
  return email.split('@')[0]
}

function renderBlocks(r: SlackCardRequest, approversLine: string | null): unknown[] {
  const isFunding = r.requestType === 'funding'
  const title = isFunding
    ? `${r.refNumber} · Funding · ${fmtAmount(r.amount, r.currency)}`
    : `${r.refNumber} · ${r.vendorName} · ${fmtAmount(r.amount, r.currency)}`

  const facts: string[] = []
  facts.push(`*Type:* ${isFunding ? 'Funding (wallet top-up)' : 'Payment'}`)
  facts.push(`*Submitter:* ${shortEmail(r.submitterEmail)}`)
  if (isFunding) {
    if (r.network) facts.push(`*Network:* ${r.network}`)
    if (r.token) facts.push(`*Token:* ${r.token}`)
  } else {
    if (r.department) facts.push(`*Department:* ${r.department}`)
    if (r.entity) facts.push(`*Entity:* ${r.entity}`)
  }

  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${title}*` } },
    { type: 'section', fields: facts.map((f) => ({ type: 'mrkdwn', text: f })) },
  ]
  if (r.description) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: r.description.slice(0, 280) }] })
  }
  if (isFunding && r.walletAddress) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `\`${r.walletAddress}\`` }] })
  }
  const statusText = STATUS_LINE[r.status] ?? r.status
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: approversLine ? `${statusText}\n${approversLine}` : statusText },
  })
  return blocks
}

function fallbackText(r: SlackCardRequest): string {
  return `${r.refNumber} · ${r.vendorName} · ${fmtAmount(r.amount, r.currency)} · ${r.status}`
}

/** Post the status card for a newly submitted request. Returns the message
 * ts (store it on the request) or null. */
export async function slackPostApprovalCard(
  r: SlackCardRequest,
  approversLine: string | null,
): Promise<string | null> {
  const body = await slackCall('chat.postMessage', {
    channel: CHANNEL,
    text: fallbackText(r),
    blocks: renderBlocks(r, approversLine),
    unfurl_links: false,
  })
  return typeof body?.ts === 'string' ? body.ts : null
}

/** Re-render the status card in place (status changed / votes advanced). */
export async function slackUpdateApprovalCard(
  ts: string | null | undefined,
  r: SlackCardRequest,
  approversLine: string | null,
): Promise<void> {
  if (!ts) return
  await slackCall('chat.update', {
    channel: CHANNEL,
    ts,
    text: fallbackText(r),
    blocks: renderBlocks(r, approversLine),
  })
}

/** Drop a detail line in the card's thread (vote cast, rejection note,
 * payment reference, cancellation). */
export async function slackThreadEvent(ts: string | null | undefined, text: string): Promise<void> {
  if (!ts) return
  await slackCall('chat.postMessage', {
    channel: CHANNEL,
    thread_ts: ts,
    text,
    unfurl_links: false,
  })
}
