import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

/**
 * Invoice field extraction for the payment-request form: the submitter
 * uploads the invoice FIRST, Claude reads it, and the form is prefilled.
 * The human always reviews before submitting — extraction is a draft, never
 * an authority (SOX: the submitter attests to what they submit).
 *
 * Dormant without ANTHROPIC_API_KEY (the endpoint returns 503 with a clear
 * message). Cost per invoice is a few cents on claude-opus-5.
 */

export type ExtractedInvoiceFields = {
  vendorName: string | null
  description: string | null
  amount: number | null
  currency: string | null
  invoiceNumber: string | null
  invoiceDate: string | null   // YYYY-MM-DD
  dueDate: string | null       // YYYY-MM-DD
}

const EXTRACTION_PROMPT = `Extract the following fields from this invoice and return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
- "vendorName": the company issuing the invoice (the party to be paid), string or null
- "description": a one-line summary of what the invoice is for, string or null
- "amount": the TOTAL amount due as a plain number (no thousands separators), number or null
- "currency": the 3-5 letter currency code (USD, EUR, USDC, ...), string or null
- "invoiceNumber": the invoice reference/number, string or null
- "invoiceDate": the invoice issue date as YYYY-MM-DD, string or null
- "dueDate": the payment due date as YYYY-MM-DD, string or null

Use null for anything not clearly present in the document. Do not guess.`

export function invoiceExtractionEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export async function extractInvoiceFields(
  bytes: Buffer,
  contentType: string,
): Promise<ExtractedInvoiceFields> {
  const client = new Anthropic()

  const data = bytes.toString('base64')
  const fileBlock = contentType === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: (SUPPORTED_IMAGE_TYPES.has(contentType) ? contentType : 'image/jpeg') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data,
        },
      }

  // Server-side refusal fallback on by default per current API guidance —
  // if the primary model declines, the same request re-runs on a fallback
  // model inside this call.
  const response = await client.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: [fileBlock, { type: 'text', text: EXTRACTION_PROMPT }],
    }],
  })

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('The model declined to read this document'), { statusCode: 422 })
  }

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    // Defensive: strip markdown fences if the model added them anyway.
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text)
  } catch {
    throw Object.assign(new Error('Could not parse the extraction result — try a clearer copy of the invoice'), { statusCode: 422 })
  }

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const dateOk = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[, ]/g, '')) : NaN
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
  }

  return {
    vendorName: str(parsed.vendorName),
    description: str(parsed.description),
    amount: num(parsed.amount),
    currency: str(parsed.currency)?.toUpperCase() ?? null,
    invoiceNumber: str(parsed.invoiceNumber),
    invoiceDate: dateOk(str(parsed.invoiceDate)),
    dueDate: dateOk(str(parsed.dueDate)),
  }
}
